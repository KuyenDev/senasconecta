/**
 * Cliente HTTP REST para comunicarse de forma segura con el Cloudflare Worker de SeñasConecta.
 */

import { getApiBaseUrl } from './config.js';
import { state } from './state.js';

let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

export class ApiError extends Error {
  constructor(message, status = 500, code = 'ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function buildApiUrl(path) {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export async function apiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && state.csrfToken) {
    headers.set('X-CSRF-Token', state.csrfToken);
  }

  let response;
  try {
    response = await fetch(buildApiUrl(path), {
      method,
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      'No se pudo conectar con el servidor de SeñasConecta. Verifica tu conexión o la configuración del Worker.',
      0,
      'NETWORK_ERROR'
    );
  }

  if (options.rawResponse) {
    if (!response.ok) {
      let errData = {};
      try {
        errData = await response.json();
      } catch {
        // Ignorar si no es JSON
      }
      if (response.status === 401 && unauthorizedHandler && !options.skipAuthRedirect) {
        unauthorizedHandler(errData.code || 'UNAUTHORIZED');
      }
      throw new ApiError(
        errData.error || 'Error al descargar el archivo.',
        response.status,
        errData.code || 'ERROR',
        errData.details || null
      );
    }
    return response;
  }

  let payload = null;
  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    const text = await response.text();
    payload = text ? { message: text } : {};
  }

  if (!response.ok) {
    if (!contentType.includes('application/json') && [0, 404, 502, 503].includes(response.status)) {
      throw new ApiError(
        'No se encontró la API del Worker en esta dirección. En desarrollo local, inicia el servidor con python3 scripts/dev_local.py.',
        response.status,
        'BACKEND_UNREACHABLE',
        payload?.details || null
      );
    }
    if (response.status === 401 && unauthorizedHandler && !options.skipAuthRedirect) {
      unauthorizedHandler(payload?.code || 'UNAUTHORIZED');
    }
    throw new ApiError(
      payload?.error || 'Ocurrió un error al procesar la solicitud.',
      response.status,
      payload?.code || 'ERROR',
      payload?.details || null
    );
  }

  return payload;
}

export async function refreshReferenceData() {
  const [configData, locData, congData] = await Promise.all([
    apiFetch('/api/configuracion'),
    apiFetch('/api/localidades?incluir_inactivas=1'),
    apiFetch('/api/congregaciones?incluir_inactivas=1'),
  ]);
  state.categorias = configData.categorias || {};
  state.localidades = locData.items || [];
  state.congregaciones = congData.items || [];
  return { configData, locData, congData };
}

