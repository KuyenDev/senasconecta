/**
 * Rutas para consultar y ampliar categorías configurables del sistema.
 */

import { execute, getActiveCategoriesMap, queryOne } from '../database.js';
import { getCookiePolicy } from '../middleware/auth.js';
import { errorResponse, jsonResponse, parseJsonBody, parsePositiveId } from '../utils.js';
import { cleanText, parseBoolFlag } from '../validation.js';

const ALLOWED_GROUPS = new Set([
  'estado_registro',
  'medio_comunicacion',
  'nivel_lsch',
  'tipo_seguimiento',
  'estado_seguimiento',
]);

export async function handleConfiguracionRoutes(request, env, requestUrl, auth = null) {
  const path = requestUrl.pathname;

  if (path === '/api/configuracion' && request.method === 'GET') {
    const categorias = await getActiveCategoriesMap(env.DB);
    if (!auth?.ok) {
      return jsonResponse({ categorias });
    }
    const cookiePolicy = getCookiePolicy(request, env);
    return jsonResponse({
      categorias,
      sistema: {
        cookie_mode: cookiePolicy.mode,
        session_ttl_hours: Math.max(1, Math.min(168, Number(env.SESSION_TTL_HOURS || 12) || 12)),
      },
    });
  }

  if (path === '/api/configuracion/categorias' && request.method === 'POST') {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    const grupo = String(parsed.data.grupo || '').trim();
    if (!ALLOWED_GROUPS.has(grupo)) {
      return errorResponse('El grupo de categoría indicado no es válido.', 400, 'VALIDATION_ERROR');
    }

    const etiquetaRes = cleanText(parsed.data.etiqueta, 80);
    if (!etiquetaRes || typeof etiquetaRes === 'object') {
      return errorResponse('La etiqueta de la categoría no es válida.', 400, 'VALIDATION_ERROR');
    }

    const claveRaw = String(parsed.data.clave || etiquetaRes)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50);

    if (!claveRaw) {
      return errorResponse('No se pudo generar una clave válida para la categoría.', 400, 'VALIDATION_ERROR');
    }

    const dup = await queryOne(
      env.DB,
      'SELECT id FROM configuracion_categorias WHERE grupo = ? AND clave = ?',
      [grupo, claveRaw]
    );
    if (dup) {
      return errorResponse('Ya existe una categoría con esa clave en el grupo seleccionado.', 409, 'DUPLICATE');
    }

    const maxRow = await queryOne(
      env.DB,
      'SELECT COALESCE(MAX(orden), 0) AS max_orden FROM configuracion_categorias WHERE grupo = ?',
      [grupo]
    );

    const res = await execute(
      env.DB,
      'INSERT INTO configuracion_categorias (grupo, clave, etiqueta, orden, activa) VALUES (?, ?, ?, ?, 1)',
      [grupo, claveRaw, etiquetaRes, Number(maxRow?.max_orden || 0) + 1]
    );

    const id = Number(res?.meta?.last_row_id || res?.lastRowId);
    const created = await queryOne(env.DB, 'SELECT * FROM configuracion_categorias WHERE id = ?', [id]);
    return jsonResponse({ categoria: created }, 201);
  }

  const idMatch = /^\/api\/configuracion\/categorias\/(\d+)$/.exec(path);
  if (idMatch && (request.method === 'PUT' || request.method === 'PATCH')) {
    const catId = parsePositiveId(idMatch[1]);
    if (!catId) return errorResponse('Identificador de categoría inválido.', 400, 'INVALID_ID');

    const existing = await queryOne(env.DB, 'SELECT * FROM configuracion_categorias WHERE id = ?', [catId]);
    if (!existing) return errorResponse('Categoría no encontrada.', 404, 'NOT_FOUND');

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return errorResponse(parsed.error, parsed.status, 'INVALID_JSON');

    let nextEtiqueta = existing.etiqueta;
    if (parsed.data.etiqueta !== undefined) {
      const cleaned = cleanText(parsed.data.etiqueta, 80);
      if (!cleaned || typeof cleaned === 'object') {
        return errorResponse('La etiqueta ingresada no es válida.', 400, 'VALIDATION_ERROR');
      }
      nextEtiqueta = cleaned;
    }

    let nextActiva = existing.activa;
    if (parsed.data.activa !== undefined) {
      const flag = parseBoolFlag(parsed.data.activa, existing.activa);
      if (!flag.ok) return errorResponse(flag.error, 400, 'VALIDATION_ERROR');
      nextActiva = flag.value;
    }

    await execute(env.DB, 'UPDATE configuracion_categorias SET etiqueta = ?, activa = ? WHERE id = ?', [
      nextEtiqueta,
      nextActiva,
      catId,
    ]);
    const updated = await queryOne(env.DB, 'SELECT * FROM configuracion_categorias WHERE id = ?', [catId]);
    return jsonResponse({ categoria: updated });
  }

  return null;
}

