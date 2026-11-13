/**
 * Rutas para gestión flexible de Congregaciones y sus localidades de cobertura.
 */

import { execute, queryAll, queryOne } from '../database.js';
import {
  errorResponse,
  jsonResponse,
  nowISO,
  parseJsonBody,
  parsePositiveId,
} from '../utils.js';
import { parseBoolFlag, validateCongregacionPayload } from '../validation.js';

const CONGREGACION_LIST_SQL = `
  SELECT
    c.*,
    l.nombre AS localidad_nombre,
    (SELECT COUNT(*) FROM personas p WHERE p.congregacion_id = c.id) AS personas_count
  FROM congregaciones c
  LEFT JOIN localidades l ON l.id = c.localidad_id
`;

async function syncCongregacionLocalidades(db, congregacionId, localidadesIds, primaryLocalidadId) {
  const combined = new Set(localidadesIds || []);
  if (primaryLocalidadId) {
    combined.add(primaryLocalidadId);
  }

  await execute(db, 'DELETE FROM congregacion_localidades WHERE congregacion_id = ?', [congregacionId]);
  for (const locId of combined) {
    await execute(
      db,
      'INSERT OR IGNORE INTO congregacion_localidades (congregacion_id, localidad_id) VALUES (?, ?)',
      [congregacionId, locId]
    );
  }
}

async function attachLocalidadesMap(db, items) {
  if (!items.length) return items;
  const rows = await queryAll(
    db,
    `SELECT cl.congregacion_id, l.id, l.nombre, l.activa
     FROM congregacion_localidades cl
     JOIN localidades l ON l.id = cl.localidad_id
     ORDER BY l.nombre COLLATE NOCASE ASC`
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.congregacion_id)) {
      map.set(row.congregacion_id, []);
    }
    map.get(row.congregacion_id).push({ id: row.id, nombre: row.nombre, activa: row.activa });
  }
  return items.map((c) => ({
    ...c,
    localidades_cubiertas: map.get(c.id) || (c.localidad_id && c.localidad_nombre ? [{ id: c.localidad_id, nombre: c.localidad_nombre, activa: 1 }] : []),
  }));
}

async function validateLocalidadesExist(db, ids) {
  for (const id of ids) {
    if (!id) continue;
    const exists = await queryOne(db, 'SELECT id FROM localidades WHERE id = ?', [id]);
    if (!exists) return `La localidad con identificador ${id} no existe.`;
  }
  return null;
}

export async function handleCongregacionesRoutes(request, env, requestUrl) {
  const path = requestUrl.pathname;

  if (path === '/api/congregaciones' && request.method === 'GET') {
    const includeInactive = requestUrl.searchParams.get('incluir_inactivas') !== '0';
    const whereSql = includeInactive ? '' : 'WHERE c.activa = 1';
    const rows = await queryAll(
      env.DB,
      `${CONGREGACION_LIST_SQL} ${whereSql} ORDER BY c.activa DESC, c.nombre COLLATE NOCASE ASC`
    );
    const items = await attachLocalidadesMap(env.DB, rows);
    return jsonResponse({ items });
  }

  if (path === '/api/congregaciones' && request.method === 'POST') {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const validation = validateCongregacionPayload(parsed.data, false);
    if (!validation.ok) {
      return errorResponse(validation.errors[0], 400, 'VALIDATION_ERROR', validation.errors);
    }

    const d = validation.data;
    const dup = await queryOne(env.DB, 'SELECT id FROM congregaciones WHERE nombre = ? COLLATE NOCASE', [
      d.nombre,
    ]);
    if (dup) {
      return errorResponse('Ya existe una congregación con ese nombre.', 409, 'DUPLICATE_NAME');
    }

    const allLocIds = [...(d.localidades_ids || [])];
    if (d.localidad_id) allLocIds.push(d.localidad_id);
    const locErr = await validateLocalidadesExist(env.DB, allLocIds);
    if (locErr) return errorResponse(locErr, 400, 'INVALID_REFERENCE');

    const now = nowISO();
    const res = await execute(
      env.DB,
      `INSERT INTO congregaciones (nombre, localidad_id, descripcion, activa, fecha_creacion, fecha_actualizacion)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [d.nombre, d.localidad_id ?? null, d.descripcion || '', d.activa ?? 1, now, now]
    );

    const id = Number(res?.meta?.last_row_id || res?.lastRowId);
    await syncCongregacionLocalidades(env.DB, id, d.localidades_ids || [], d.localidad_id);

    const created = await queryOne(env.DB, `${CONGREGACION_LIST_SQL} WHERE c.id = ?`, [id]);
    const [enriched] = await attachLocalidadesMap(env.DB, [created]);
    return jsonResponse({ congregacion: enriched }, 201);
  }

  const stateMatch = /^\/api\/congregaciones\/(\d+)\/estado$/.exec(path);
  if (stateMatch && request.method === 'PATCH') {
    const congId = parsePositiveId(stateMatch[1]);
    if (!congId) return errorResponse('Identificador de congregación inválido.', 400, 'INVALID_ID');

    const existing = await queryOne(env.DB, 'SELECT * FROM congregaciones WHERE id = ?', [congId]);
    if (!existing) return errorResponse('Congregación no encontrada.', 404, 'NOT_FOUND');

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const flag = parseBoolFlag(parsed.data.activa, existing.activa ? 0 : 1);
    if (!flag.ok) return errorResponse(flag.error, 400, 'VALIDATION_ERROR');

    await execute(env.DB, 'UPDATE congregaciones SET activa = ?, fecha_actualizacion = ? WHERE id = ?', [
      flag.value,
      nowISO(),
      congId,
    ]);
    const updated = await queryOne(env.DB, `${CONGREGACION_LIST_SQL} WHERE c.id = ?`, [congId]);
    const [enriched] = await attachLocalidadesMap(env.DB, [updated]);
    return jsonResponse({ congregacion: enriched });
  }

  const idMatch = /^\/api\/congregaciones\/(\d+)$/.exec(path);
  if (!idMatch) return null;

  const congId = parsePositiveId(idMatch[1]);
  if (!congId) return errorResponse('Identificador de congregación inválido.', 400, 'INVALID_ID');

  if (request.method === 'GET') {
    const row = await queryOne(env.DB, `${CONGREGACION_LIST_SQL} WHERE c.id = ?`, [congId]);
    if (!row) return errorResponse('Congregación no encontrada.', 404, 'NOT_FOUND');

    const [congregacion] = await attachLocalidadesMap(env.DB, [row]);
    const personas = await queryAll(
      env.DB,
      `SELECT p.id, p.codigo_interno, p.nombre, p.apellido, p.sector, p.estado, l.nombre AS localidad_nombre
       FROM personas p
       LEFT JOIN localidades l ON l.id = p.localidad_id
       WHERE p.congregacion_id = ?
       ORDER BY p.nombre COLLATE NOCASE ASC`,
      [congId]
    );

    return jsonResponse({ congregacion, personas });
  }

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const existing = await queryOne(env.DB, 'SELECT * FROM congregaciones WHERE id = ?', [congId]);
    if (!existing) return errorResponse('Congregación no encontrada.', 404, 'NOT_FOUND');

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const validation = validateCongregacionPayload(parsed.data, true);
    if (!validation.ok) {
      return errorResponse(validation.errors[0], 400, 'VALIDATION_ERROR', validation.errors);
    }

    const d = validation.data;
    const nextNombre = d.nombre !== undefined ? d.nombre : existing.nombre;
    const dup = await queryOne(
      env.DB,
      'SELECT id FROM congregaciones WHERE nombre = ? COLLATE NOCASE AND id != ?',
      [nextNombre, congId]
    );
    if (dup) {
      return errorResponse('Ya existe otra congregación con ese nombre.', 409, 'DUPLICATE_NAME');
    }

    const nextLocId = d.localidad_id !== undefined ? d.localidad_id : existing.localidad_id;
    const checkIds = [...(d.localidades_ids || [])];
    if (nextLocId) checkIds.push(nextLocId);
    const locErr = await validateLocalidadesExist(env.DB, checkIds);
    if (locErr) return errorResponse(locErr, 400, 'INVALID_REFERENCE');

    await execute(
      env.DB,
      `UPDATE congregaciones SET
        nombre = ?, localidad_id = ?, descripcion = ?, activa = ?, fecha_actualizacion = ?
      WHERE id = ?`,
      [
        nextNombre,
        nextLocId,
        d.descripcion !== undefined ? d.descripcion : existing.descripcion,
        d.activa !== undefined ? d.activa : existing.activa,
        nowISO(),
        congId,
      ]
    );

    if (d.localidades_ids !== undefined) {
      await syncCongregacionLocalidades(env.DB, congId, d.localidades_ids, nextLocId);
    } else if (d.localidad_id !== undefined && d.localidad_id) {
      await execute(
        env.DB,
        'INSERT OR IGNORE INTO congregacion_localidades (congregacion_id, localidad_id) VALUES (?, ?)',
        [congId, d.localidad_id]
      );
    }

    const updated = await queryOne(env.DB, `${CONGREGACION_LIST_SQL} WHERE c.id = ?`, [congId]);
    const [enriched] = await attachLocalidadesMap(env.DB, [updated]);
    return jsonResponse({ congregacion: enriched });
  }

  if (request.method === 'DELETE') {
    const existing = await queryOne(env.DB, `${CONGREGACION_LIST_SQL} WHERE c.id = ?`, [congId]);
    if (!existing) return errorResponse('Congregación no encontrada.', 404, 'NOT_FOUND');

    const force = requestUrl.searchParams.get('force') === '1';
    if (!force && Number(existing.personas_count) > 0) {
      return errorResponse(
        `Esta congregación tiene ${existing.personas_count} personas asociadas. Desactívala o confirma su eliminación para desvincularlas.`,
        409,
        'LINKED_RECORDS',
        { personas_count: Number(existing.personas_count) }
      );
    }

    await execute(env.DB, 'DELETE FROM congregaciones WHERE id = ?', [congId]);
    return jsonResponse({ ok: true, id: congId });
  }

  return null;
}

