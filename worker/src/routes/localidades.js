/**
 * Rutas para gestión independiente y flexible de Localidades territoriales.
 */

import { execute, queryAll, queryOne } from '../database.js';
import {
  errorResponse,
  jsonResponse,
  nowISO,
  parseJsonBody,
  parsePositiveId,
} from '../utils.js';
import { parseBoolFlag, validateLocalidadPayload } from '../validation.js';

const LOCALIDAD_LIST_SQL = `
  SELECT
    l.*,
    (SELECT COUNT(*) FROM personas p WHERE p.localidad_id = l.id) AS personas_count,
    (SELECT COUNT(*) FROM personas p WHERE p.localidad_id = l.id AND p.estado = 'confirmado') AS confirmados_count,
    (
      SELECT COUNT(DISTINCT c_id) FROM (
        SELECT id AS c_id FROM congregaciones WHERE localidad_id = l.id
        UNION
        SELECT congregacion_id AS c_id FROM congregacion_localidades WHERE localidad_id = l.id
      )
    ) AS congregaciones_count,
    (
      SELECT COUNT(*) FROM seguimientos s
      LEFT JOIN personas p ON p.id = s.persona_id
      WHERE (s.localidad_id = l.id OR (s.localidad_id IS NULL AND p.localidad_id = l.id))
        AND s.estado IN ('pendiente', 'en_curso')
    ) AS seguimientos_pendientes_count
  FROM localidades l
`;

export async function handleLocalidadesRoutes(request, env, requestUrl) {
  const path = requestUrl.pathname;

  if (path === '/api/localidades' && request.method === 'GET') {
    const includeInactive = requestUrl.searchParams.get('incluir_inactivas') !== '0';
    const whereSql = includeInactive ? '' : 'WHERE l.activa = 1';
    const items = await queryAll(
      env.DB,
      `${LOCALIDAD_LIST_SQL} ${whereSql} ORDER BY l.activa DESC, l.nombre COLLATE NOCASE ASC`
    );

    const sectoresRows = await queryAll(
      env.DB,
      `SELECT localidad_id, TRIM(sector) AS sector, COUNT(*) AS total
       FROM personas
       WHERE localidad_id IS NOT NULL AND TRIM(sector) != ''
       GROUP BY localidad_id, TRIM(sector)
       ORDER BY total DESC, sector COLLATE NOCASE ASC`
    );

    const sectoresMap = new Map();
    for (const row of sectoresRows) {
      if (!sectoresMap.has(row.localidad_id)) {
        sectoresMap.set(row.localidad_id, []);
      }
      sectoresMap.get(row.localidad_id).push({ nombre: row.sector, total: Number(row.total) });
    }

    const enriched = items.map((item) => ({
      ...item,
      sectores: sectoresMap.get(item.id) || [],
    }));

    return jsonResponse({ items: enriched });
  }

  if (path === '/api/localidades' && request.method === 'POST') {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const validation = validateLocalidadPayload(parsed.data, false);
    if (!validation.ok) {
      return errorResponse(validation.errors[0], 400, 'VALIDATION_ERROR', validation.errors);
    }

    const d = validation.data;
    const dup = await queryOne(env.DB, 'SELECT id FROM localidades WHERE nombre = ? COLLATE NOCASE', [
      d.nombre,
    ]);
    if (dup) {
      return errorResponse('Ya existe una localidad con ese nombre.', 409, 'DUPLICATE_NAME');
    }

    const now = nowISO();
    const res = await execute(
      env.DB,
      `INSERT INTO localidades (nombre, region, descripcion, latitud, longitud, activa, fecha_creacion, fecha_actualizacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.nombre, d.region || '', d.descripcion || '', d.latitud ?? null, d.longitud ?? null, d.activa ?? 1, now, now]
    );

    const id = Number(res?.meta?.last_row_id || res?.lastRowId);
    const created = await queryOne(env.DB, `${LOCALIDAD_LIST_SQL} WHERE l.id = ?`, [id]);
    return jsonResponse({ localidad: { ...created, sectores: [] } }, 201);
  }

  const stateMatch = /^\/api\/localidades\/(\d+)\/estado$/.exec(path);
  if (stateMatch && request.method === 'PATCH') {
    const locId = parsePositiveId(stateMatch[1]);
    if (!locId) return errorResponse('Identificador de localidad inválido.', 400, 'INVALID_ID');

    const existing = await queryOne(env.DB, 'SELECT * FROM localidades WHERE id = ?', [locId]);
    if (!existing) return errorResponse('Localidad no encontrada.', 404, 'NOT_FOUND');

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const flag = parseBoolFlag(parsed.data.activa, existing.activa ? 0 : 1);
    if (!flag.ok) return errorResponse(flag.error, 400, 'VALIDATION_ERROR');

    await execute(env.DB, 'UPDATE localidades SET activa = ?, fecha_actualizacion = ? WHERE id = ?', [
      flag.value,
      nowISO(),
      locId,
    ]);
    const updated = await queryOne(env.DB, `${LOCALIDAD_LIST_SQL} WHERE l.id = ?`, [locId]);
    return jsonResponse({ localidad: updated });
  }

  const idMatch = /^\/api\/localidades\/(\d+)$/.exec(path);
  if (!idMatch) return null;

  const locId = parsePositiveId(idMatch[1]);
  if (!locId) return errorResponse('Identificador de localidad inválido.', 400, 'INVALID_ID');

  if (request.method === 'GET') {
    const localidad = await queryOne(env.DB, `${LOCALIDAD_LIST_SQL} WHERE l.id = ?`, [locId]);
    if (!localidad) return errorResponse('Localidad no encontrada.', 404, 'NOT_FOUND');

    const [personas, congregaciones] = await Promise.all([
      queryAll(
        env.DB,
        `SELECT p.id, p.codigo_interno, p.nombre, p.apellido, p.sector, p.estado, c.nombre AS congregacion_nombre
         FROM personas p
         LEFT JOIN congregaciones c ON c.id = p.congregacion_id
         WHERE p.localidad_id = ?
         ORDER BY p.nombre COLLATE NOCASE ASC`,
        [locId]
      ),
      queryAll(
        env.DB,
        `SELECT DISTINCT c.id, c.nombre, c.activa
         FROM congregaciones c
         LEFT JOIN congregacion_localidades cl ON cl.congregacion_id = c.id
         WHERE c.localidad_id = ? OR cl.localidad_id = ?
         ORDER BY c.nombre COLLATE NOCASE ASC`,
        [locId, locId]
      ),
    ]);

    return jsonResponse({ localidad, personas, congregaciones });
  }

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const existing = await queryOne(env.DB, 'SELECT * FROM localidades WHERE id = ?', [locId]);
    if (!existing) return errorResponse('Localidad no encontrada.', 404, 'NOT_FOUND');

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const validation = validateLocalidadPayload(parsed.data, true);
    if (!validation.ok) {
      return errorResponse(validation.errors[0], 400, 'VALIDATION_ERROR', validation.errors);
    }

    const d = validation.data;
    const nextNombre = d.nombre !== undefined ? d.nombre : existing.nombre;
    const dup = await queryOne(
      env.DB,
      'SELECT id FROM localidades WHERE nombre = ? COLLATE NOCASE AND id != ?',
      [nextNombre, locId]
    );
    if (dup) {
      return errorResponse('Ya existe otra localidad con ese nombre.', 409, 'DUPLICATE_NAME');
    }

    await execute(
      env.DB,
      `UPDATE localidades SET
        nombre = ?, region = ?, descripcion = ?, latitud = ?, longitud = ?, activa = ?, fecha_actualizacion = ?
      WHERE id = ?`,
      [
        nextNombre,
        d.region !== undefined ? d.region : existing.region,
        d.descripcion !== undefined ? d.descripcion : existing.descripcion,
        d.latitud !== undefined ? d.latitud : existing.latitud,
        d.longitud !== undefined ? d.longitud : existing.longitud,
        d.activa !== undefined ? d.activa : existing.activa,
        nowISO(),
        locId,
      ]
    );

    const updated = await queryOne(env.DB, `${LOCALIDAD_LIST_SQL} WHERE l.id = ?`, [locId]);
    return jsonResponse({ localidad: updated });
  }

  if (request.method === 'DELETE') {
    const existing = await queryOne(env.DB, `${LOCALIDAD_LIST_SQL} WHERE l.id = ?`, [locId]);
    if (!existing) return errorResponse('Localidad no encontrada.', 404, 'NOT_FOUND');

    const force = requestUrl.searchParams.get('force') === '1';
    if (!force && (Number(existing.personas_count) > 0 || Number(existing.congregaciones_count) > 0)) {
      return errorResponse(
        `Esta localidad tiene ${existing.personas_count} personas y ${existing.congregaciones_count} congregaciones asociadas. Desactívala o confirma su eliminación para desvincular los registros.`,
        409,
        'LINKED_RECORDS',
        {
          personas_count: Number(existing.personas_count),
          congregaciones_count: Number(existing.congregaciones_count),
        }
      );
    }

    await execute(env.DB, 'DELETE FROM localidades WHERE id = ?', [locId]);
    return jsonResponse({ ok: true, id: locId });
  }

  return null;
}

