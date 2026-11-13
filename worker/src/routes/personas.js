/**
 * Rutas CRUD y búsqueda avanzada para el Registro de Personas (SeñasConecta).
 */

import {
  execute,
  generateUniquePersonCode,
  getCategorySet,
  queryAll,
  queryOne,
} from '../database.js';
import {
  errorResponse,
  jsonResponse,
  nowISO,
  parseJsonBody,
  parsePositiveId,
} from '../utils.js';
import { validatePersonaPayload } from '../validation.js';

const SORT_COLUMNS = {
  nombre: 'LOWER(p.nombre)',
  apellido: 'LOWER(p.apellido)',
  codigo_interno: 'p.codigo_interno',
  localidad: 'LOWER(COALESCE(l.nombre, ""))',
  congregacion: 'LOWER(COALESCE(c.nombre, ""))',
  estado: 'p.estado',
  fecha_actualizacion: 'p.fecha_actualizacion',
  fecha_creacion: 'p.fecha_creacion',
  fecha_ultima_visita: 'COALESCE(p.fecha_ultima_visita, "")',
};

const PERSON_SELECT_SQL = `
  SELECT
    p.*,
    l.nombre AS localidad_nombre,
    c.nombre AS congregacion_nombre,
    (SELECT COUNT(*) FROM seguimientos s WHERE s.persona_id = p.id) AS total_seguimientos,
    (SELECT COUNT(*) FROM seguimientos s WHERE s.persona_id = p.id AND s.estado IN ('pendiente', 'en_curso')) AS seguimientos_pendientes
  FROM personas p
  LEFT JOIN localidades l ON l.id = p.localidad_id
  LEFT JOIN congregaciones c ON c.id = p.congregacion_id
`;

async function loadPersonaCategories(db) {
  const [estado_registro, medio_comunicacion, nivel_lsch] = await Promise.all([
    getCategorySet(db, 'estado_registro'),
    getCategorySet(db, 'medio_comunicacion'),
    getCategorySet(db, 'nivel_lsch'),
  ]);
  return { estado_registro, medio_comunicacion, nivel_lsch };
}

async function verifyForeignKeys(db, localidadId, congregacionId) {
  if (localidadId !== null && localidadId !== undefined) {
    const loc = await queryOne(db, 'SELECT id FROM localidades WHERE id = ?', [localidadId]);
    if (!loc) return 'La localidad seleccionada no existe.';
  }
  if (congregacionId !== null && congregacionId !== undefined) {
    const cong = await queryOne(db, 'SELECT id FROM congregaciones WHERE id = ?', [congregacionId]);
    if (!cong) return 'La congregación seleccionada no existe.';
  }
  return null;
}

export async function handlePersonasRoutes(request, env, requestUrl) {
  const path = requestUrl.pathname;

  if (path === '/api/personas' && request.method === 'GET') {
    const sp = requestUrl.searchParams;
    const where = [];
    const params = [];

    const q = (sp.get('q') || '').trim();
    if (q) {
      const pattern = `%${q}%`;
      where.push(
        `(p.nombre LIKE ? OR p.apellido LIKE ? OR (p.nombre || ' ' || p.apellido) LIKE ? OR p.codigo_interno LIKE ? OR p.sector LIKE ? OR p.observaciones LIKE ?)`
      );
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    const locFilter = sp.get('localidad_id');
    if (locFilter === 'none') {
      where.push('p.localidad_id IS NULL');
    } else if (locFilter) {
      const locId = parsePositiveId(locFilter);
      if (locId) {
        where.push('p.localidad_id = ?');
        params.push(locId);
      }
    }

    const congFilter = sp.get('congregacion_id');
    if (congFilter === 'none') {
      where.push('p.congregacion_id IS NULL');
    } else if (congFilter) {
      const congId = parsePositiveId(congFilter);
      if (congId) {
        where.push('p.congregacion_id = ?');
        params.push(congId);
      }
    }

    const estadoFilter = (sp.get('estado') || '').trim();
    if (estadoFilter) {
      where.push('p.estado = ?');
      params.push(estadoFilter);
    }

    const usaLschFilter = sp.get('usa_lsch');
    if (usaLschFilter === '1' || usaLschFilter === '0') {
      where.push('p.usa_lsch = ?');
      params.push(Number(usaLschFilter));
    } else if (usaLschFilter === 'null') {
      where.push('p.usa_lsch IS NULL');
    }

    const interpFilter = sp.get('necesita_interpretacion');
    if (interpFilter === '1' || interpFilter === '0') {
      where.push('p.necesita_interpretacion = ?');
      params.push(Number(interpFilter));
    } else if (interpFilter === 'null') {
      where.push('p.necesita_interpretacion IS NULL');
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sortKey = sp.get('sort') || 'fecha_actualizacion';
    const sortExpr = SORT_COLUMNS[sortKey] || SORT_COLUMNS.fecha_actualizacion;
    const orderDir = (sp.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '50', 10) || 50));
    const offset = (page - 1) * limit;

    const countRow = await queryOne(
      env.DB,
      `SELECT COUNT(*) AS total FROM personas p ${whereSql}`,
      params
    );

    const items = await queryAll(
      env.DB,
      `${PERSON_SELECT_SQL}
       ${whereSql}
       ORDER BY ${sortExpr} ${orderDir}, p.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return jsonResponse({
      items,
      total: Number(countRow?.total || 0),
      page,
      limit,
    });
  }

  if (path === '/api/personas' && request.method === 'POST') {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const categories = await loadPersonaCategories(env.DB);
    const validation = validatePersonaPayload(parsed.data, categories, {
      isUpdate: false,
      requireConsent: true,
    });
    if (!validation.ok) {
      return errorResponse(validation.errors[0], 400, 'VALIDATION_ERROR', validation.errors);
    }

    const d = validation.data;
    const fkError = await verifyForeignKeys(env.DB, d.localidad_id, d.congregacion_id);
    if (fkError) {
      return errorResponse(fkError, 400, 'INVALID_REFERENCE');
    }

    const codigoInterno = await generateUniquePersonCode(env.DB);
    const now = nowISO();

    const result = await execute(
      env.DB,
      `INSERT INTO personas (
        codigo_interno, nombre, apellido, localidad_id, sector, congregacion_id,
        fecha_incorporacion, medio_comunicacion, usa_lsch, nivel_lsch,
        prefiere_escrita, necesita_interpretacion, observaciones_comunicacion,
        estado, fecha_ultima_visita, proxima_accion, observaciones,
        consentimiento_registrado, fecha_consentimiento, nota_consentimiento,
        fecha_creacion, fecha_actualizacion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codigoInterno,
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

    const insertedId = Number(result?.meta?.last_row_id || result?.lastRowId);
    const created = await queryOne(env.DB, `${PERSON_SELECT_SQL} WHERE p.id = ?`, [insertedId]);
    return jsonResponse({ persona: created }, 201);
  }

  const idMatch = /^\/api\/personas\/(\d+)$/.exec(path);
  if (!idMatch) return null;

  const personId = parsePositiveId(idMatch[1]);
  if (!personId) {
    return errorResponse('Identificador de persona inválido.', 400, 'INVALID_ID');
  }

  if (request.method === 'GET') {
    const persona = await queryOne(env.DB, `${PERSON_SELECT_SQL} WHERE p.id = ?`, [personId]);
    if (!persona) {
      return errorResponse('No se encontró el registro solicitado.', 404, 'NOT_FOUND');
    }

    const seguimientos = await queryAll(
      env.DB,
      `SELECT s.*, l.nombre AS localidad_nombre
       FROM seguimientos s
       LEFT JOIN localidades l ON l.id = s.localidad_id
       WHERE s.persona_id = ?
       ORDER BY s.fecha DESC, s.id DESC`,
      [personId]
    );

    return jsonResponse({ persona, seguimientos });
  }

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const existing = await queryOne(env.DB, 'SELECT * FROM personas WHERE id = ?', [personId]);
    if (!existing) {
      return errorResponse('No se encontró el registro solicitado.', 404, 'NOT_FOUND');
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const categories = await loadPersonaCategories(env.DB);
    const validation = validatePersonaPayload(parsed.data, categories, {
      isUpdate: true,
      requireConsent: false,
    });
    if (!validation.ok) {
      return errorResponse(validation.errors[0], 400, 'VALIDATION_ERROR', validation.errors);
    }

    const d = validation.data;
    const nextLocId = d.localidad_id !== undefined ? d.localidad_id : existing.localidad_id;
    const nextCongId = d.congregacion_id !== undefined ? d.congregacion_id : existing.congregacion_id;
    const fkError = await verifyForeignKeys(env.DB, nextLocId, nextCongId);
    if (fkError) {
      return errorResponse(fkError, 400, 'INVALID_REFERENCE');
    }

    const merged = {
      nombre: d.nombre !== undefined ? d.nombre : existing.nombre,
      apellido: d.apellido !== undefined ? d.apellido : existing.apellido,
      localidad_id: nextLocId,
      sector: d.sector !== undefined ? d.sector : existing.sector,
      congregacion_id: nextCongId,
      fecha_incorporacion:
        d.fecha_incorporacion !== undefined ? d.fecha_incorporacion : existing.fecha_incorporacion,
      medio_comunicacion:
        d.medio_comunicacion !== undefined ? d.medio_comunicacion : existing.medio_comunicacion,
      usa_lsch: d.usa_lsch !== undefined ? d.usa_lsch : existing.usa_lsch,
      nivel_lsch: d.nivel_lsch !== undefined ? d.nivel_lsch : existing.nivel_lsch,
      prefiere_escrita:
        d.prefiere_escrita !== undefined ? d.prefiere_escrita : existing.prefiere_escrita,
      necesita_interpretacion:
        d.necesita_interpretacion !== undefined
          ? d.necesita_interpretacion
          : existing.necesita_interpretacion,
      observaciones_comunicacion:
        d.observaciones_comunicacion !== undefined
          ? d.observaciones_comunicacion
          : existing.observaciones_comunicacion,
      estado: d.estado !== undefined ? d.estado : existing.estado,
      fecha_ultima_visita:
        d.fecha_ultima_visita !== undefined ? d.fecha_ultima_visita : existing.fecha_ultima_visita,
      proxima_accion: d.proxima_accion !== undefined ? d.proxima_accion : existing.proxima_accion,
      observaciones: d.observaciones !== undefined ? d.observaciones : existing.observaciones,
      consentimiento_registrado:
        d.consentimiento_registrado !== undefined
          ? d.consentimiento_registrado
          : existing.consentimiento_registrado,
      fecha_consentimiento:
        d.fecha_consentimiento !== undefined
          ? d.fecha_consentimiento
          : existing.fecha_consentimiento,
      nota_consentimiento:
        d.nota_consentimiento !== undefined ? d.nota_consentimiento : existing.nota_consentimiento,
    };

    if (merged.usa_lsch === 0 && merged.nivel_lsch && merged.nivel_lsch !== 'no_aplica') {
      merged.nivel_lsch = 'no_aplica';
    }

    const now = nowISO();
    await execute(
      env.DB,
      `UPDATE personas SET
        nombre = ?, apellido = ?, localidad_id = ?, sector = ?, congregacion_id = ?,
        fecha_incorporacion = ?, medio_comunicacion = ?, usa_lsch = ?, nivel_lsch = ?,
        prefiere_escrita = ?, necesita_interpretacion = ?, observaciones_comunicacion = ?,
        estado = ?, fecha_ultima_visita = ?, proxima_accion = ?, observaciones = ?,
        consentimiento_registrado = ?, fecha_consentimiento = ?, nota_consentimiento = ?,
        fecha_actualizacion = ?
      WHERE id = ?`,
      [
        merged.nombre,
        merged.apellido,
        merged.localidad_id,
        merged.sector,
        merged.congregacion_id,
        merged.fecha_incorporacion,
        merged.medio_comunicacion,
        merged.usa_lsch,
        merged.nivel_lsch,
        merged.prefiere_escrita,
        merged.necesita_interpretacion,
        merged.observaciones_comunicacion,
        merged.estado,
        merged.fecha_ultima_visita,
        merged.proxima_accion,
        merged.observaciones,
        merged.consentimiento_registrado,
        merged.fecha_consentimiento,
        merged.nota_consentimiento,
        now,
        personId,
      ]
    );

    const updated = await queryOne(env.DB, `${PERSON_SELECT_SQL} WHERE p.id = ?`, [personId]);
    return jsonResponse({ persona: updated });
  }

  if (request.method === 'DELETE') {
    const existing = await queryOne(env.DB, 'SELECT id FROM personas WHERE id = ?', [personId]);
    if (!existing) {
      return errorResponse('No se encontró el registro solicitado.', 404, 'NOT_FOUND');
    }
    await execute(env.DB, 'DELETE FROM personas WHERE id = ?', [personId]);
    return jsonResponse({ ok: true, id: personId });
  }

  return null;
}

