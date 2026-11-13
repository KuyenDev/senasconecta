/**
 * Control estricto de CORS y validación de origen entre frontend y Cloudflare Worker.
 */

import { errorResponse } from '../utils.js';

export function getAllowedOrigins(env, requestUrl) {
  const allowed = new Set();

  if (env.ALLOWED_ORIGINS) {
    for (const part of String(env.ALLOWED_ORIGINS).split(',')) {
      const cleaned = part.trim().replace(/\/+$/, '');
      if (cleaned) {
        try {
          allowed.add(new URL(cleaned).origin);
        } catch {
          // Ignorar orígenes malformados en configuración
        }
      }
    }
  }

  if (env.FRONTEND_URL) {
    try {
      allowed.add(new URL(String(env.FRONTEND_URL).trim()).origin);
    } catch {
      // Ignorar si FRONTEND_URL aún no ha sido configurado
    }
  }

  // En mismo origen (por ejemplo pruebas locales o proxy bajo el mismo dominio)
  if (requestUrl) {
    allowed.add(requestUrl.origin);
  }

  return allowed;
}

export function isMutatingMethod(method) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

export function handleCorsPreflight(request, env, requestUrl) {
  const origin = request.headers.get('Origin');
  const allowed = getAllowedOrigins(env, requestUrl);

  if (!origin || !allowed.has(origin)) {
    return errorResponse('Origen no autorizado para solicitudes CORS.', 403, 'CORS_FORBIDDEN');
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  });
}

export function validateMutationOrigin(request, env, requestUrl) {
  if (!isMutatingMethod(request.method)) {
    return null;
  }

  const allowed = getAllowedOrigins(env, requestUrl);
  const origin = request.headers.get('Origin');
  if (origin) {
    if (!allowed.has(origin)) {
      return errorResponse('Origen de solicitud no autorizado.', 403, 'ORIGIN_FORBIDDEN');
    }
    return null;
  }

  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (allowed.has(refOrigin)) {
        return null;
      }
    } catch {
      // Referer inválido
    }
    return errorResponse('Referer de solicitud no autorizado.', 403, 'ORIGIN_FORBIDDEN');
  }

  // Bloquear mutaciones desde clientes sin Origin ni Referer cuando hay sesión cookie
  // (evita envíos de formularios o scripts con stripping de Referer, excepto si Sec-Fetch-Site es same-origin).
  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite === 'same-origin') {
    return null;
  }

  return errorResponse('Falta encabezado Origin autorizado para modificar datos.', 403, 'ORIGIN_REQUIRED');
}

export function attachCorsHeaders(response, request, env, requestUrl) {
  const origin = request.headers.get('Origin');
  if (!origin) return response;

  const allowed = getAllowedOrigins(env, requestUrl);
  if (!allowed.has(origin)) return response;

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.append('Vary', 'Origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

