/**
 * Rutas para el módulo de Seguimiento Territorial (SeñasConecta).
 */

import { execute, getCategorySet, queryAll, queryOne } from '../database.js';
import {
  errorResponse,
  jsonResponse,
  nowISO,
  parseJsonBody,
  parsePositiveId,
} from '../utils.js';
import { validateSeguimientoPayload } from '../validation.js';

const SEGUIMIENTO_SELECT_SQL = `
  SELECT
    s.*,
    p.nombre AS persona_nombre,
    p.apellido AS persona_apellido,
    p.codigo_interno AS persona_codigo,
    COALESCE(l_seg.nombre, l_per.nombre) AS localidad_nombre
  FROM seguimientos s
  LEFT JOIN personas p ON p.id = s.persona_id
  LEFT JOIN localidades l_seg ON l_seg.id = s.localidad_id
  LEFT JOIN localidades l_per ON l_per.id = p.localidad_id
`;

const SORT_COLUMNS = {
  fecha: 's.fecha',
  fecha_actualizacion: 's.fecha_actualizacion',
  tipo: 's.tipo',
  estado: 's.estado',
};

async function loadSeguimientoCategories(db) {
  const [tipo_seguimiento, estado_seguimiento] = await Promise.all([
    getCategorySet(db, 'tipo_seguimiento'),
    getCategorySet(db, 'estado_seguimiento'),
  ]);
  return { tipo_seguimiento, estado_seguimiento };
}

async function syncPersonVisitDate(db, personaId, tipo, estado, fecha, now) {
  if (!personaId || tipo !== 'visita_realizada' || estado !== 'completado') return;
  const person = await queryOne(db, 'SELECT fecha_ultima_visita FROM personas WHERE id = ?', [personaId]);
  if (!person) return;
  if (!person.fecha_ultima_visita || person.fecha_ultima_visita < fecha) {
    await execute(
      db,
      'UPDATE personas SET fecha_ultima_visita = ?, fecha_actualizacion = ? WHERE id = ?',
      [fecha, now, personaId]
    );
  }
}

export async function handleSeguimientosRoutes(request, env, requestUrl) {
  const path = requestUrl.pathname;

  if (path === '/api/seguimientos' && request.method === 'GET') {
    const sp = requestUrl.searchParams;
    const where = [];
    const params = [];

    const q = (sp.get('q') || '').trim();
    if (q) {
      const pattern = `%${q}%`;
      where.push(
        `(s.descripcion LIKE ? OR COALESCE(p.nombre, '') LIKE ? OR COALESCE(p.apellido, '') LIKE ? OR COALESCE(p.codigo_interno, '') LIKE ?)`
      );
      params.push(pattern, pattern, pattern, pattern);
    }

    const personaFilter = sp.get('persona_id');
    if (personaFilter) {
      const pId = parsePositiveId(personaFilter);
      if (pId) {
        where.push('s.persona_id = ?');
        params.push(pId);
      }
    }

    const locFilter = sp.get('localidad_id');
    if (locFilter) {
      const lId = parsePositiveId(locFilter);
      if (lId) {
        where.push('(s.localidad_id = ? OR (s.localidad_id IS NULL AND p.localidad_id = ?))');
        params.push(lId, lId);
      }
    }

    const tipo = (sp.get('tipo') || '').trim();
    if (tipo) {
      where.push('s.tipo = ?');
      params.push(tipo);
    }

    const estado = (sp.get('estado') || '').trim();
    if (estado) {
      where.push('s.estado = ?');
      params.push(estado);
    }

    const desde = (sp.get('desde') || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
      where.push('s.fecha >= ?');
      params.push(desde);
    }

    const hasta = (sp.get('hasta') || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      where.push('s.fecha <= ?');
      params.push(hasta);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sortExpr = SORT_COLUMNS[sp.get('sort') || 'fecha'] || SORT_COLUMNS.fecha;
    const orderDir = (sp.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const items = await queryAll(
      env.DB,
      `${SEGUIMIENTO_SELECT_SQL} ${whereSql} ORDER BY ${sortExpr} ${orderDir}, s.id DESC LIMIT 300`,
      params
    );

    return jsonResponse({ items });
  }

  if (path === '/api/seguimientos' && request.method === 'POST') {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const categories = await loadSeguimientoCategories(env.DB);
    const validation = validateSeguimientoPayload(parsed.data, categories, false);
    if (!validation.ok) {
      return errorResponse(validation.errors[0], 400, 'VALIDATION_ERROR', validation.errors);
    }

    const d = validation.data;
    let effectiveLocId = d.localidad_id ?? null;

    if (d.persona_id) {
      const person = await queryOne(env.DB, 'SELECT id, localidad_id FROM personas WHERE id = ?', [
        d.persona_id,
      ]);
      if (!person) return errorResponse('La persona seleccionada no existe.', 400, 'INVALID_REFERENCE');
      if (!effectiveLocId && person.localidad_id) {
        effectiveLocId = person.localidad_id;
      }
    }

    if (effectiveLocId) {
      const loc = await queryOne(env.DB, 'SELECT id FROM localidades WHERE id = ?', [effectiveLocId]);
      if (!loc) return errorResponse('La localidad seleccionada no existe.', 400, 'INVALID_REFERENCE');
    }

    const now = nowISO();
    const res = await execute(
      env.DB,
      `INSERT INTO seguimientos (persona_id, localidad_id, tipo, descripcion, fecha, estado, fecha_creacion, fecha_actualizacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.persona_id ?? null, effectiveLocId, d.tipo, d.descripcion, d.fecha, d.estado, now, now]
    );

    await syncPersonVisitDate(env.DB, d.persona_id, d.tipo, d.estado, d.fecha, now);

    const id = Number(res?.meta?.last_row_id || res?.lastRowId);
    const created = await queryOne(env.DB, `${SEGUIMIENTO_SELECT_SQL} WHERE s.id = ?`, [id]);
    return jsonResponse({ seguimiento: created }, 201);
  }

  const idMatch = /^\/api\/seguimientos\/(\d+)$/.exec(path);
  if (!idMatch) return null;

  const segId = parsePositiveId(idMatch[1]);
  if (!segId) return errorResponse('Identificador de seguimiento inválido.', 400, 'INVALID_ID');

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const existing = await queryOne(env.DB, 'SELECT * FROM seguimientos WHERE id = ?', [segId]);
    if (!existing) return errorResponse('Seguimiento no encontrado.', 404, 'NOT_FOUND');

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const categories = await loadSeguimientoCategories(env.DB);
    const validation = validateSeguimientoPayload(parsed.data, categories, true);
    if (!validation.ok) {
      return errorResponse(validation.errors[0], 400, 'VALIDATION_ERROR', validation.errors);
    }

    const d = validation.data;
    const nextPersonaId = d.persona_id !== undefined ? d.persona_id : existing.persona_id;
    const nextLocId = d.localidad_id !== undefined ? d.localidad_id : existing.localidad_id;

    if (nextPersonaId) {
      const p = await queryOne(env.DB, 'SELECT id FROM personas WHERE id = ?', [nextPersonaId]);
      if (!p) return errorResponse('La persona seleccionada no existe.', 400, 'INVALID_REFERENCE');
    }
    if (nextLocId) {
      const l = await queryOne(env.DB, 'SELECT id FROM localidades WHERE id = ?', [nextLocId]);
      if (!l) return errorResponse('La localidad seleccionada no existe.', 400, 'INVALID_REFERENCE');
    }

    const nextTipo = d.tipo !== undefined ? d.tipo : existing.tipo;
    const nextEstado = d.estado !== undefined ? d.estado : existing.estado;
    const nextFecha = d.fecha !== undefined ? d.fecha : existing.fecha;
    const nextDesc = d.descripcion !== undefined ? d.descripcion : existing.descripcion;
    const now = nowISO();

    await execute(
      env.DB,
      `UPDATE seguimientos SET
        persona_id = ?, localidad_id = ?, tipo = ?, descripcion = ?, fecha = ?, estado = ?, fecha_actualizacion = ?
      WHERE id = ?`,
      [nextPersonaId, nextLocId, nextTipo, nextDesc, nextFecha, nextEstado, now, segId]
    );

    await syncPersonVisitDate(env.DB, nextPersonaId, nextTipo, nextEstado, nextFecha, now);

    const updated = await queryOne(env.DB, `${SEGUIMIENTO_SELECT_SQL} WHERE s.id = ?`, [segId]);
    return jsonResponse({ seguimiento: updated });
  }

  if (request.method === 'DELETE') {
    const existing = await queryOne(env.DB, 'SELECT id FROM seguimientos WHERE id = ?', [segId]);
    if (!existing) return errorResponse('Seguimiento no encontrado.', 404, 'NOT_FOUND');

    await execute(env.DB, 'DELETE FROM seguimientos WHERE id = ?', [segId]);
    return jsonResponse({ ok: true, id: segId });
  }

  return null;
}

