/**
 * Utilidades criptográficas, HTTP y de saneamiento para SeñasConecta Worker.
 */

const textEncoder = new TextEncoder();

export function nowISO() {
  return new Date().toISOString();
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(input)));
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Comparación en tiempo constante mediante hash SHA-256 de ambas entradas
 * para evitar filtración de longitud o prefijos por tiempo.
 */
export async function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', textEncoder.encode(a)),
    crypto.subtle.digest('SHA-256', textEncoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  let diff = a.length ^ b.length;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function errorResponse(message, status = 400, code = 'ERROR', details = null) {
  const payload = { error: message, code };
  if (details !== null) {
    payload.details = details;
  }
  return jsonResponse(payload, status);
}

export async function parseJsonBody(request, maxBytes = 1_048_576) {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, status: 413, error: 'La solicitud supera el tamaño máximo permitido.' };
  }
  const raw = await request.text();
  if (textEncoder.encode(raw).length > maxBytes) {
    return { ok: false, status: 413, error: 'El cuerpo JSON supera el tamaño máximo permitido.' };
  }
  if (!raw.trim()) {
    return { ok: false, status: 400, error: 'El cuerpo de la solicitud no puede estar vacío.' };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return { ok: false, status: 400, error: 'El JSON debe representar un objeto o arreglo válido.' };
    }
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, status: 400, error: 'El formato JSON enviado no es válido.' };
  }
}

export function parseCookies(cookieHeader) {
  const cookies = Object.create(null);
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.expires) {
    segments.push(`Expires=${new Date(options.expires).toUTCString()}`);
  }
  segments.push(`Path=${options.path || '/'}`);
  if (options.domain) {
    segments.push(`Domain=${options.domain}`);
  }
  if (options.httpOnly !== false) {
    segments.push('HttpOnly');
  }
  if (options.secure) {
    segments.push('Secure');
  }
  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }
  return segments.join('; ');
}

const MULTI_TENANT_SUFFIXES = new Set([
  'github.io',
  'workers.dev',
  'pages.dev',
  'netlify.app',
  'vercel.app',
  'com.cl',
  'org.cl',
  'gob.cl',
  'co.uk',
  'com.ar',
]);

/**
 * Determina el sitio registrable (eTLD+1 aproximado) para distinguir
 * despliegue en mismo sitio vs sitios cruzados (ej. github.io vs workers.dev).
 */
export function getSiteKey(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return '';
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    return host;
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('.');
  }
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_TENANT_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

export function parsePositiveId(raw) {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

