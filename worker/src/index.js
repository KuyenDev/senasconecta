/**
 * Punto de entrada principal del Cloudflare Worker de SeñasConecta.
 */

import { requireAdmin } from './middleware/auth.js';
import { attachCorsHeaders, handleCorsPreflight } from './middleware/cors.js';
import { enforceRateLimit } from './middleware/rateLimit.js';
import { applySecurityHeaders } from './middleware/security.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleConfiguracionRoutes } from './routes/configuracion.js';
import { handleCongregacionesRoutes } from './routes/congregaciones.js';
import { handleDashboardRoutes } from './routes/dashboard.js';
import { handleEstadisticasRoutes } from './routes/estadisticas.js';
import { handleLocalidadesRoutes } from './routes/localidades.js';
import { handlePersonasRoutes } from './routes/personas.js';
import { handleRespaldosRoutes } from './routes/respaldos.js';
import { handleSeguimientosRoutes } from './routes/seguimientos.js';
import { errorResponse, jsonResponse } from './utils.js';

const API_ROUTE_HANDLERS = [
  handleDashboardRoutes,
  handlePersonasRoutes,
  handleLocalidadesRoutes,
  handleCongregacionesRoutes,
  handleSeguimientosRoutes,
  handleEstadisticasRoutes,
  handleRespaldosRoutes,
  handleConfiguracionRoutes,
];

function isPublicReadEndpoint(request, pathname) {
  if (request.method !== 'GET') return false;
  return (
    pathname === '/api/dashboard' ||
    pathname === '/api/estadisticas' ||
    pathname === '/api/configuracion' ||
    pathname === '/api/seguimientos' ||
    pathname === '/api/localidades' ||
    /^\/api\/localidades\/\d+$/.test(pathname) ||
    pathname === '/api/congregaciones' ||
    /^\/api\/congregaciones\/\d+$/.test(pathname) ||
    pathname === '/api/personas' ||
    /^\/api\/personas\/\d+$/.test(pathname)
  );
}

async function routeRequest(request, env, requestUrl) {
  if (request.method === 'OPTIONS') {
    return handleCorsPreflight(request, env, requestUrl);
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    return jsonResponse({ ok: true, service: 'senasconecta-api' });
  }

  const authResponse = await handleAuthRoutes(request, env, requestUrl);
  if (authResponse) {
    return authResponse;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    const rateErr = await enforceRateLimit(request, env, 'api');
    if (rateErr) return rateErr;

    let auth = null;
    if (!isPublicReadEndpoint(request, requestUrl.pathname)) {
      auth = await requireAdmin(request, env, requestUrl);
      if (!auth.ok) return auth.response;
    }

    for (const handler of API_ROUTE_HANDLERS) {
      const res = await handler(request, env, requestUrl, auth);
      if (res) return res;
    }

    return errorResponse('Recurso de API no encontrado.', 404, 'NOT_FOUND');
  }

  return errorResponse('Ruta no encontrada.', 404, 'NOT_FOUND');
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    let response;
    try {
      response = await routeRequest(request, env, requestUrl);
    } catch {
      // No exponer trazas internas ni detalles de base de datos en respuestas de error
      response = errorResponse(
        'Ocurrió un error interno al procesar la solicitud.',
        500,
        'INTERNAL_ERROR'
      );
    }

    const withCors = attachCorsHeaders(response, request, env, requestUrl);
    return applySecurityHeaders(withCors, requestUrl);
  },
};

