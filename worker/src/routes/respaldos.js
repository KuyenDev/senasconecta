/**
 * Rutas para Exportación (CSV / JSON) e Importación segura con vista previa y prevención de duplicados.
 */

import {
  execute,
  generateUniquePersonCode,
  getCategorySet,
  queryAll,
  queryOne,
} from '../database.js';
import { enforceRateLimit } from '../middleware/rateLimit.js';
import {
  errorResponse,
  jsonResponse,
  nowISO,
  parseJsonBody,
  todayDate,
} from '../utils.js';
import {
  cleanText,
  parseIsoDate,
  validateCongregacionPayload,
  validateLocalidadPayload,
  validatePersonaPayload,
  validateSeguimientoPayload,
} from '../validation.js';

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Mitigación de inyección de fórmulas en hojas de cálculo (CSV Injection)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function triBoolLabel(val) {
  if (val === 1 || val === true) return 'Sí';
  if (val === 0 || val === false) return 'No';
  return 'Sin especificar';
}

function normalizeNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function personNaturalKey(nombre, apellido, localidadNombre) {
  return [
    normalizeNameKey(nombre),
    normalizeNameKey(apellido),
    normalizeNameKey(localidadNombre),
  ].join('|');
}

function seguimientoNaturalKey(personaKey, tipo, fecha, descripcion) {
  return [
    String(personaKey || ''),
    normalizeNameKey(tipo),
    String(fecha || ''),
    normalizeNameKey(descripcion),
  ].join('|');
}

async function loadAllCategories(db) {
  const [estado_registro, medio_comunicacion, nivel_lsch, tipo_seguimiento, estado_seguimiento] =
    await Promise.all([
      getCategorySet(db, 'estado_registro'),
      getCategorySet(db, 'medio_comunicacion'),
      getCategorySet(db, 'nivel_lsch'),
      getCategorySet(db, 'tipo_seguimiento'),
      getCategorySet(db, 'estado_seguimiento'),
    ]);
  return {
    estado_registro,
    medio_comunicacion,
    nivel_lsch,
    tipo_seguimiento,
    estado_seguimiento,
  };
}

async function buildFullBackupObject(db) {
  const [localidades, congregaciones, congLocs, personas, seguimientos] = await Promise.all([
    queryAll(db, 'SELECT id, nombre, region, descripcion, latitud, longitud, activa, fecha_creacion, fecha_actualizacion FROM localidades ORDER BY id ASC'),
    queryAll(
      db,
      `SELECT c.id, c.nombre, c.localidad_id, l.nombre AS localidad_nombre, c.descripcion, c.activa, c.fecha_creacion, c.fecha_actualizacion
       FROM congregaciones c
       LEFT JOIN localidades l ON l.id = c.localidad_id
       ORDER BY c.id ASC`
    ),
    queryAll(
      db,
      `SELECT cl.congregacion_id, l.nombre AS localidad_nombre
       FROM congregacion_localidades cl
       JOIN localidades l ON l.id = cl.localidad_id`
    ),
    queryAll(
      db,
      `SELECT p.*, l.nombre AS localidad_nombre, c.nombre AS congregacion_nombre
       FROM personas p
       LEFT JOIN localidades l ON l.id = p.localidad_id
       LEFT JOIN congregaciones c ON c.id = p.congregacion_id
       ORDER BY p.id ASC`
    ),
    queryAll(
      db,
      `SELECT s.*, p.codigo_interno AS persona_codigo, l.nombre AS localidad_nombre
       FROM seguimientos s
       LEFT JOIN personas p ON p.id = s.persona_id
       LEFT JOIN localidades l ON l.id = s.localidad_id
       ORDER BY s.id ASC`
    ),
  ]);

  const covMap = new Map();
  for (const row of congLocs) {
    if (!covMap.has(row.congregacion_id)) covMap.set(row.congregacion_id, []);
    covMap.get(row.congregacion_id).push(row.localidad_nombre);
  }

  return {
    app: 'senasconecta',
    version: 1,
    exported_at: nowISO(),
    localidades,
    congregaciones: congregaciones.map((c) => ({
      ...c,
      localidades_nombres: covMap.get(c.id) || (c.localidad_nombre ? [c.localidad_nombre] : []),
    })),
    personas,
    seguimientos,
  };
}

async function processImportPlan(db, payload, options = { dryRun: true, strategy: 'omitir' }) {
  const { dryRun, strategy } = options;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'El archivo de respaldo debe ser un objeto JSON válido.' };
  }
  if (payload.app !== undefined && payload.app !== 'senasconecta') {
    return { ok: false, error: 'El archivo JSON no corresponde a un respaldo de SeñasConecta.' };
  }

  const rawLocalidades = Array.isArray(payload.localidades) ? payload.localidades : [];
  const rawCongregaciones = Array.isArray(payload.congregaciones) ? payload.congregaciones : [];
  const rawPersonas = Array.isArray(payload.personas) ? payload.personas : [];
  const rawSeguimientos = Array.isArray(payload.seguimientos) ? payload.seguimientos : [];

  if (!Array.isArray(payload.personas) && !Array.isArray(payload.localidades) && !Array.isArray(payload.congregaciones)) {
    return {
      ok: false,
      error: 'El respaldo no contiene arreglos válidos de localidades, congregaciones o personas.',
    };
  }

  if (
    rawLocalidades.length > 1000 ||
    rawCongregaciones.length > 1000 ||
    rawPersonas.length > 5000 ||
    rawSeguimientos.length > 10000
  ) {
    return { ok: false, error: 'El respaldo supera los límites máximos de registros permitidos por lote.' };
  }

  const categories = await loadAllCategories(db);
  const existingLocs = await queryAll(db, 'SELECT * FROM localidades');
  const existingCongs = await queryAll(db, 'SELECT * FROM congregaciones');
  const existingPersonas = await queryAll(
    db,
    `SELECT p.*, l.nombre AS localidad_nombre
     FROM personas p
     LEFT JOIN localidades l ON l.id = p.localidad_id`
  );
  const existingSegs = await queryAll(
    db,
    `SELECT s.*, p.codigo_interno AS persona_codigo
     FROM seguimientos s
     LEFT JOIN personas p ON p.id = s.persona_id`
  );

  const locByKey = new Map(existingLocs.map((l) => [normalizeNameKey(l.nombre), l]));
  const congByKey = new Map(existingCongs.map((c) => [normalizeNameKey(c.nombre), c]));
  const personaByCode = new Map(
    existingPersonas.filter((p) => p.codigo_interno).map((p) => [p.codigo_interno.toUpperCase(), p])
  );
  const personaByNatural = new Map(
    existingPersonas.map((p) => [personNaturalKey(p.nombre, p.apellido, p.localidad_nombre), p])
  );
  const segKeys = new Set(
    existingSegs.map((s) =>
      seguimientoNaturalKey(s.persona_codigo || s.persona_id || '', s.tipo, s.fecha, s.descripcion)
    )
  );

  const stats = {
    localidades: { nuevos: 0, modificados: 0, omitidos: 0, rechazados: 0 },
    congregaciones: { nuevos: 0, modificados: 0, omitidos: 0, rechazados: 0 },
    personas: { nuevos: 0, modificados: 0, omitidos: 0, rechazados: 0 },
    seguimientos: { nuevos: 0, modificados: 0, omitidos: 0, rechazados: 0 },
  };
  const errores = [];
  const now = nowISO();

  // Simular IDs en modo dryRun para que las referencias posteriores dentro del mismo archivo se resuelvan bien
  let virtualLocId = -1;
  let virtualCongId = -1;
  let virtualPersonaId = -1;
  const seenBackupCodes = new Set();

  // 1. Localidades
  for (let i = 0; i < rawLocalidades.length; i += 1) {
    const item = rawLocalidades[i];
    if (!item || typeof item !== 'object') {
      stats.localidades.rechazados += 1;
      errores.push({ seccion: 'localidades', indice: i + 1, referencia: `#${i + 1}`, motivo: 'Formato de objeto inválido.' });
      continue;
    }
    const val = validateLocalidadPayload(item, false);
    if (!val.ok) {
      stats.localidades.rechazados += 1;
      errores.push({ seccion: 'localidades', indice: i + 1, referencia: item.nombre || `#${i + 1}`, motivo: val.errors[0] });
      continue;
    }
    const d = val.data;
    const key = normalizeNameKey(d.nombre);
    const existing = locByKey.get(key);

    if (existing) {
      if (strategy === 'actualizar' && existing.id > 0) {
        stats.localidades.modificados += 1;
        if (!dryRun) {
          await execute(
            db,
            'UPDATE localidades SET region = ?, descripcion = ?, latitud = ?, longitud = ?, activa = ?, fecha_actualizacion = ? WHERE id = ?',
            [d.region || '', d.descripcion || '', d.latitud ?? null, d.longitud ?? null, d.activa ?? 1, now, existing.id]
          );
        }
      } else {
        stats.localidades.omitidos += 1;
      }
    } else {
      stats.localidades.nuevos += 1;
      let newId = virtualLocId--;
      if (!dryRun) {
        const res = await execute(
          db,
          'INSERT INTO localidades (nombre, region, descripcion, latitud, longitud, activa, fecha_creacion, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [d.nombre, d.region || '', d.descripcion || '', d.latitud ?? null, d.longitud ?? null, d.activa ?? 1, now, now]
        );
        newId = Number(res?.meta?.last_row_id || res?.lastRowId);
      }
      locByKey.set(key, { id: newId, nombre: d.nombre });
    }
  }

  // 2. Congregaciones
  for (let i = 0; i < rawCongregaciones.length; i += 1) {
    const item = rawCongregaciones[i];
    if (!item || typeof item !== 'object') {
      stats.congregaciones.rechazados += 1;
      errores.push({ seccion: 'congregaciones', indice: i + 1, referencia: `#${i + 1}`, motivo: 'Formato de objeto inválido.' });
      continue;
    }

    const mappedItem = { ...item, localidad_id: null, localidades_ids: [] };
    const val = validateCongregacionPayload(mappedItem, false);
    if (!val.ok) {
      stats.congregaciones.rechazados += 1;
      errores.push({ seccion: 'congregaciones', indice: i + 1, referencia: item.nombre || `#${i + 1}`, motivo: val.errors[0] });
      continue;
    }

    const d = val.data;
    const primaryLocName = item.localidad_nombre ? normalizeNameKey(item.localidad_nombre) : '';
    const resolvedPrimaryLoc = primaryLocName ? locByKey.get(primaryLocName) : null;
    const primaryLocId = resolvedPrimaryLoc && resolvedPrimaryLoc.id > 0 ? resolvedPrimaryLoc.id : null;

    const coveredLocNames = Array.isArray(item.localidades_nombres) ? item.localidades_nombres : [];
    const coveredLocIds = [];
    for (const ln of coveredLocNames) {
      const found = locByKey.get(normalizeNameKey(ln));
      if (found && found.id > 0) coveredLocIds.push(found.id);
    }
    if (primaryLocId && !coveredLocIds.includes(primaryLocId)) {
      coveredLocIds.push(primaryLocId);
    }

    const key = normalizeNameKey(d.nombre);
    const existing = congByKey.get(key);

    if (existing) {
      if (strategy === 'actualizar' && existing.id > 0) {
        stats.congregaciones.modificados += 1;
        if (!dryRun) {
          await execute(
            db,
            'UPDATE congregaciones SET localidad_id = ?, descripcion = ?, activa = ?, fecha_actualizacion = ? WHERE id = ?',
            [primaryLocId, d.descripcion || '', d.activa ?? 1, now, existing.id]
          );
          for (const lid of coveredLocIds) {
            await execute(
              db,
              'INSERT OR IGNORE INTO congregacion_localidades (congregacion_id, localidad_id) VALUES (?, ?)',
              [existing.id, lid]
            );
          }
        }
      } else {
        stats.congregaciones.omitidos += 1;
      }
    } else {
      stats.congregaciones.nuevos += 1;
      let newId = virtualCongId--;
      if (!dryRun) {
        const res = await execute(
          db,
          'INSERT INTO congregaciones (nombre, localidad_id, descripcion, activa, fecha_creacion, fecha_actualizacion) VALUES (?, ?, ?, ?, ?, ?)',
          [d.nombre, primaryLocId, d.descripcion || '', d.activa ?? 1, now, now]
        );
        newId = Number(res?.meta?.last_row_id || res?.lastRowId);
        for (const lid of coveredLocIds) {
          await execute(
            db,
            'INSERT OR IGNORE INTO congregacion_localidades (congregacion_id, localidad_id) VALUES (?, ?)',
            [newId, lid]
          );
        }
      }
      congByKey.set(key, { id: newId, nombre: d.nombre });
    }
  }

  // 3. Personas
  for (let i = 0; i < rawPersonas.length; i += 1) {
    const item = rawPersonas[i];
    if (!item || typeof item !== 'object') {
      stats.personas.rechazados += 1;
      errores.push({ seccion: 'personas', indice: i + 1, referencia: `#${i + 1}`, motivo: 'Formato de objeto inválido.' });
      continue;
    }

    const locName = item.localidad_nombre || item.localidad || '';
    const congName = item.congregacion_nombre || item.congregacion || '';
    const matchedLoc = locName ? locByKey.get(normalizeNameKey(locName)) : null;
    const matchedCong = congName ? congByKey.get(normalizeNameKey(congName)) : null;

    if (locName && !matchedLoc) {
      stats.personas.rechazados += 1;
      errores.push({
        seccion: 'personas',
        indice: i + 1,
        referencia: `${item.nombre || ''} ${item.apellido || ''}`.trim() || `#${i + 1}`,
        motivo: `La localidad "${locName}" no existe ni está incluida en el respaldo.`,
      });
      continue;
    }
    if (congName && !matchedCong) {
      stats.personas.rechazados += 1;
      errores.push({
        seccion: 'personas',
        indice: i + 1,
        referencia: `${item.nombre || ''} ${item.apellido || ''}`.trim() || `#${i + 1}`,
        motivo: `La congregación "${congName}" no existe ni está incluida en el respaldo.`,
      });
      continue;
    }

    const candidate = {
      ...item,
      localidad_id: matchedLoc && matchedLoc.id > 0 ? matchedLoc.id : null,
      congregacion_id: matchedCong && matchedCong.id > 0 ? matchedCong.id : null,
    };

    const val = validatePersonaPayload(candidate, categories, {
      isUpdate: false,
      requireConsent: false,
    });
    if (!val.ok) {
      stats.personas.rechazados += 1;
      errores.push({
        seccion: 'personas',
        indice: i + 1,
        referencia: `${item.nombre || ''} ${item.apellido || ''}`.trim() || `#${i + 1}`,
        motivo: val.errors[0],
      });
      continue;
    }

    const d = val.data;
    const codeRaw = cleanText(item.codigo_interno, 40);
    const codeUpper = typeof codeRaw === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(codeRaw) ? codeRaw.toUpperCase() : '';

    if (codeUpper && seenBackupCodes.has(codeUpper)) {
      stats.personas.rechazados += 1;
      errores.push({
        seccion: 'personas',
        indice: i + 1,
        referencia: codeUpper,
        motivo: `Código interno duplicado (${codeUpper}) dentro del mismo archivo.`,
      });
      continue;
    }
    if (codeUpper) seenBackupCodes.add(codeUpper);

    const natKey = personNaturalKey(d.nombre, d.apellido || '', matchedLoc ? matchedLoc.nombre : '');
    const existing = (codeUpper && personaByCode.get(codeUpper)) || personaByNatural.get(natKey);

    if (existing) {
      if (strategy === 'actualizar' && existing.id > 0) {
        stats.personas.modificados += 1;
        if (!dryRun) {
          await execute(
            db,
            `UPDATE personas SET
              nombre = ?, apellido = ?, localidad_id = ?, sector = ?, congregacion_id = ?,
              fecha_incorporacion = ?, medio_comunicacion = ?, usa_lsch = ?, nivel_lsch = ?,
              prefiere_escrita = ?, necesita_interpretacion = ?, observaciones_comunicacion = ?,
              estado = ?, fecha_ultima_visita = ?, proxima_accion = ?, observaciones = ?,
              consentimiento_registrado = ?, fecha_consentimiento = ?, nota_consentimiento = ?,
              fecha_actualizacion = ?
            WHERE id = ?`,
            [
              d.nombre,
              d.apellido || '',
              d.localidad_id ?? null,
              d.sector || '',
              d.congregacion_id ?? null,
              d.fecha_incorporacion ?? null,
              d.medio_comunicacion || '',
              d.usa_lsch ?? null,
              d.nivel_lsch || '',
              d.prefiere_escrita ?? null,
              d.necesita_interpretacion ?? null,
              d.observaciones_comunicacion || '',
              d.estado || 'por_confirmar',
              d.fecha_ultima_visita ?? null,
              d.proxima_accion || '',
              d.observaciones || '',
              d.consentimiento_registrado ? 1 : 0,
              d.fecha_consentimiento ?? null,
              d.nota_consentimiento || '',
              now,
              existing.id,
            ]
          );
        }
      } else {
        stats.personas.omitidos += 1;
      }
    } else {
      stats.personas.nuevos += 1;
      let finalCode = codeUpper;
      let newId = virtualPersonaId--;

      if (!dryRun) {
        if (!finalCode || (await queryOne(db, 'SELECT id FROM personas WHERE codigo_interno = ?', [finalCode]))) {
          finalCode = await generateUniquePersonCode(db);
        }
        const res = await execute(
          db,
          `INSERT INTO personas (
            codigo_interno, nombre, apellido, localidad_id, sector, congregacion_id,
            fecha_incorporacion, medio_comunicacion, usa_lsch, nivel_lsch,
            prefiere_escrita, necesita_interpretacion, observaciones_comunicacion,
            estado, fecha_ultima_visita, proxima_accion, observaciones,
            consentimiento_registrado, fecha_consentimiento, nota_consentimiento,
            fecha_creacion, fecha_actualizacion
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            finalCode,
            d.nombre,
            d.apellido || '',
            d.localidad_id ?? null,
            d.sector || '',
            d.congregacion_id ?? null,
            d.fecha_incorporacion ?? null,
            d.medio_comunicacion || '',
            d.usa_lsch ?? null,
            d.nivel_lsch || '',
            d.prefiere_escrita ?? null,
            d.necesita_interpretacion ?? null,
            d.observaciones_comunicacion || '',
            d.estado || 'por_confirmar',
            d.fecha_ultima_visita ?? null,
            d.proxima_accion || '',
            d.observaciones || '',
            d.consentimiento_registrado ? 1 : 0,
            d.fecha_consentimiento ?? null,
            d.nota_consentimiento || '',
            now,
            now,
          ]
        );
        newId = Number(res?.meta?.last_row_id || res?.lastRowId);
      } else if (!finalCode) {
        finalCode = `SC-TMP-${Math.abs(newId)}`;
      }

      const stored = { id: newId, codigo_interno: finalCode, nombre: d.nombre };
      personaByCode.set(finalCode.toUpperCase(), stored);
      personaByNatural.set(natKey, stored);
    }
  }

  // 4. Seguimientos
  for (let i = 0; i < rawSeguimientos.length; i += 1) {
    const item = rawSeguimientos[i];
    if (!item || typeof item !== 'object') {
      stats.seguimientos.rechazados += 1;
      errores.push({ seccion: 'seguimientos', indice: i + 1, referencia: `#${i + 1}`, motivo: 'Formato de objeto inválido.' });
      continue;
    }

    const pCode = item.persona_codigo ? String(item.persona_codigo).trim().toUpperCase() : '';
    const matchedPersona = pCode ? personaByCode.get(pCode) : null;
    if (pCode && !matchedPersona) {
      stats.seguimientos.rechazados += 1;
      errores.push({
        seccion: 'seguimientos',
        indice: i + 1,
        referencia: pCode,
        motivo: `La persona asociada (${pCode}) no se encuentra disponible.`,
      });
      continue;
    }

    const locName = item.localidad_nombre || '';
    const matchedLoc = locName ? locByKey.get(normalizeNameKey(locName)) : null;

    const val = validateSeguimientoPayload(
      {
        ...item,
        persona_id: matchedPersona && matchedPersona.id > 0 ? matchedPersona.id : null,
        localidad_id: matchedLoc && matchedLoc.id > 0 ? matchedLoc.id : null,
      },
      categories,
      false
    );
    if (!val.ok) {
      stats.seguimientos.rechazados += 1;
      errores.push({
        seccion: 'seguimientos',
        indice: i + 1,
        referencia: item.fecha || `#${i + 1}`,
        motivo: val.errors[0],
      });
      continue;
    }

    const d = val.data;
    const fechaCheck = parseIsoDate(d.fecha);
    if (!fechaCheck.ok) {
      stats.seguimientos.rechazados += 1;
      continue;
    }

    const sKey = seguimientoNaturalKey(
      pCode || (matchedPersona ? matchedPersona.codigo_interno : ''),
      d.tipo,
      d.fecha,
      d.descripcion
    );

    if (segKeys.has(sKey)) {
      stats.seguimientos.omitidos += 1;
    } else {
      stats.seguimientos.nuevos += 1;
      segKeys.add(sKey);
      if (!dryRun) {
        await execute(
          db,
          `INSERT INTO seguimientos (persona_id, localidad_id, tipo, descripcion, fecha, estado, fecha_creacion, fecha_actualizacion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.persona_id ?? null, d.localidad_id ?? null, d.tipo, d.descripcion, d.fecha, d.estado, now, now]
        );
      }
    }
  }

  const totales = { nuevos: 0, modificados: 0, omitidos: 0, rechazados: 0 };
  for (const sec of Object.values(stats)) {
    totales.nuevos += sec.nuevos;
    totales.modificados += sec.modificados;
    totales.omitidos += sec.omitidos;
    totales.rechazados += sec.rechazados;
  }

  return {
    ok: true,
    resumen: {
      ...stats,
      totales,
    },
    errores: errores.slice(0, 100),
  };
}

export async function handleRespaldosRoutes(request, env, requestUrl) {
  const path = requestUrl.pathname;

  if (path === '/api/respaldos/exportar' && request.method === 'GET') {
    const formato = (requestUrl.searchParams.get('formato') || 'json').toLowerCase();
    const dateStamp = todayDate();

    if (formato === 'json') {
      const backup = await buildFullBackupObject(env.DB);
      return new Response(JSON.stringify(backup, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="senasconecta-respaldo-${dateStamp}.json"`,
        },
      });
    }

    if (formato === 'csv') {
      const rows = await queryAll(
        env.DB,
        `SELECT
          p.codigo_interno, p.nombre, p.apellido,
          COALESCE(l.nombre, '') AS localidad,
          p.sector,
          COALESCE(c.nombre, '') AS congregacion,
          p.fecha_incorporacion, p.medio_comunicacion,
          p.usa_lsch, p.nivel_lsch, p.prefiere_escrita, p.necesita_interpretacion,
          p.observaciones_comunicacion, p.estado, p.fecha_ultima_visita,
          p.proxima_accion, p.observaciones,
          p.consentimiento_registrado, p.fecha_consentimiento,
          p.fecha_creacion, p.fecha_actualizacion
        FROM personas p
        LEFT JOIN localidades l ON l.id = p.localidad_id
        LEFT JOIN congregaciones c ON c.id = p.congregacion_id
        ORDER BY p.id ASC`
      );

      const headers = [
        'codigo_interno',
        'nombre',
        'apellido',
        'localidad',
        'sector',
        'congregacion',
        'fecha_incorporacion',
        'medio_comunicacion',
        'usa_lsch',
        'nivel_lsch',
        'prefiere_escrita',
        'necesita_interpretacion',
        'observaciones_comunicacion',
        'estado',
        'fecha_ultima_visita',
        'proxima_accion',
        'observaciones',
        'consentimiento_registrado',
        'fecha_consentimiento',
        'fecha_creacion',
        'fecha_actualizacion',
      ];

      const lines = [headers.join(',')];
      for (const r of rows) {
        lines.push(
          [
            escapeCsvCell(r.codigo_interno),
            escapeCsvCell(r.nombre),
            escapeCsvCell(r.apellido),
            escapeCsvCell(r.localidad),
            escapeCsvCell(r.sector),
            escapeCsvCell(r.congregacion),
            escapeCsvCell(r.fecha_incorporacion || ''),
            escapeCsvCell(r.medio_comunicacion),
            escapeCsvCell(triBoolLabel(r.usa_lsch)),
            escapeCsvCell(r.nivel_lsch),
            escapeCsvCell(triBoolLabel(r.prefiere_escrita)),
            escapeCsvCell(triBoolLabel(r.necesita_interpretacion)),
            escapeCsvCell(r.observaciones_comunicacion),
            escapeCsvCell(r.estado),
            escapeCsvCell(r.fecha_ultima_visita || ''),
            escapeCsvCell(r.proxima_accion),
            escapeCsvCell(r.observaciones),
            escapeCsvCell(r.consentimiento_registrado ? 'Sí' : 'No'),
            escapeCsvCell(r.fecha_consentimiento || ''),
            escapeCsvCell(r.fecha_creacion),
            escapeCsvCell(r.fecha_actualizacion),
          ].join(',')
        );
      }

      const csvBody = `\uFEFF${lines.join('\r\n')}`;
      return new Response(csvBody, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="senasconecta-personas-${dateStamp}.csv"`,
        },
      });
    }

    return errorResponse('Formato de exportación no soportado. Usa json o csv.', 400, 'INVALID_FORMAT');
  }

  if (path === '/api/respaldos/previsualizar' && request.method === 'POST') {
    const rateErr = await enforceRateLimit(request, env, 'import');
    if (rateErr) return rateErr;

    const parsed = await parseJsonBody(request, 5_242_880);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const strategy = parsed.data.estrategia_duplicados === 'actualizar' ? 'actualizar' : 'omitir';
    const backupObj = parsed.data.respaldo || parsed.data;
    const plan = await processImportPlan(env.DB, backupObj, { dryRun: true, strategy });
    if (!plan.ok) {
      return errorResponse(plan.error, 400, 'INVALID_BACKUP');
    }

    return jsonResponse({
      resumen: plan.resumen,
      errores: plan.errores,
      estrategia_duplicados: strategy,
    });
  }

  if (path === '/api/respaldos/importar' && request.method === 'POST') {
    const rateErr = await enforceRateLimit(request, env, 'import');
    if (rateErr) return rateErr;

    const parsed = await parseJsonBody(request, 5_242_880);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    if (parsed.data.confirmado !== true) {
      return errorResponse(
        'Debes confirmar explícitamente la importación después de revisar el resumen.',
        400,
        'CONFIRMATION_REQUIRED'
      );
    }

    const strategy = parsed.data.estrategia_duplicados === 'actualizar' ? 'actualizar' : 'omitir';
    const backupObj = parsed.data.respaldo || parsed.data;
    const result = await processImportPlan(env.DB, backupObj, { dryRun: false, strategy });
    if (!result.ok) {
      return errorResponse(result.error, 400, 'INVALID_BACKUP');
    }

    return jsonResponse({
      ok: true,
      resumen: result.resumen,
      errores: result.errores,
      estrategia_duplicados: strategy,
    });
  }

  return null;
}

