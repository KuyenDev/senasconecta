/**
 * Middleware de autenticación de único administrador y validación CSRF/sesiones.
 */

import { queryOne, execute } from '../database.js';
import {
  constantTimeEqual,
  errorResponse,
  getSiteKey,
  nowISO,
  parseCookies,
  sha256Hex,
} from '../utils.js';
import { isMutatingMethod, validateMutationOrigin } from './cors.js';

export function getAdminGithubId(env) {
  const raw = String(env.ADMIN_GITHUB_ID || '').trim();
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  return raw;
}

export function getCookiePolicy(request, env) {
  const requestUrl = new URL(request.url);
  const isHttps = requestUrl.protocol === 'https:';
  const cookieDomain = String(env.COOKIE_DOMAIN || '').trim() || undefined;
  const requestedMode = String(env.COOKIE_SAMESITE || 'auto').trim().toLowerCase();

  let frontendHost = '';
  let frontendProtocol = '';
  if (env.FRONTEND_URL) {
    try {
      const fUrl = new URL(String(env.FRONTEND_URL).trim());
      frontendHost = fUrl.hostname;
      frontendProtocol = fUrl.protocol;
    } catch {
      // Ignorar FRONTEND_URL malformado
    }
  }

  let sameSite = 'Lax';
  if (!isHttps) {
    // Los navegadores rechazan SameSite=None sin Secure en HTTP local
    sameSite = 'Lax';
  } else if (requestedMode === 'none') {
    sameSite = 'None';
  } else if (requestedMode === 'lax') {
    sameSite = 'Lax';
  } else if (cookieDomain) {
    sameSite = 'Lax';
  } else if (
    frontendHost &&
    frontendProtocol === requestUrl.protocol &&
    getSiteKey(frontendHost) === getSiteKey(requestUrl.hostname)
  ) {
    sameSite = 'Lax';
  } else if (frontendHost && getSiteKey(frontendHost) !== getSiteKey(requestUrl.hostname)) {
    sameSite = 'None';
  }

  const name = isHttps && !cookieDomain && sameSite === 'Lax' ? '__Host-sc_session' : 'sc_session';
  const mode =
    sameSite === 'None'
      ? 'cross-site-none'
      : cookieDomain
        ? 'same-site-domain'
        : 'same-origin-lax';

  return {
    name,
    sameSite,
    secure: isHttps,
    domain: isHttps ? cookieDomain : undefined,
    mode,
  };
}

export async function resolveSession(request, env) {
  const adminId = getAdminGithubId(env);
  if (!adminId) {
    return { authenticated: false, reason: 'MISCONFIGURED' };
  }

  const policy = getCookiePolicy(request, env);
  const cookies = parseCookies(request.headers.get('Cookie'));
  const rawToken = cookies[policy.name];
  if (!rawToken || rawToken.length < 20) {
    return { authenticated: false, policy };
  }

  const tokenHash = await sha256Hex(rawToken);
  const session = await queryOne(
    env.DB,
    `SELECT id, token_hash, csrf_token, github_user_id, github_login, github_name, avatar_url, expiracion, fecha_creacion, ultimo_acceso
     FROM sesiones
     WHERE token_hash = ?`,
    [tokenHash]
  );

  if (!session) {
    return { authenticated: false, policy };
  }

  const expiresMs = Date.parse(session.expiracion);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    await execute(env.DB, 'DELETE FROM sesiones WHERE id = ?', [session.id]);
    return { authenticated: false, expired: true, policy };
  }

  const idMatches = await constantTimeEqual(String(session.github_user_id), adminId);
  if (!idMatches) {
    await execute(env.DB, 'DELETE FROM sesiones WHERE id = ?', [session.id]);
    return { authenticated: false, forbidden: true, policy };
  }

  // Actualizar ultimo_acceso con bajo costo (máximo cada 5 minutos)
  const lastAccessMs = Date.parse(session.ultimo_acceso);
  if (!Number.isFinite(lastAccessMs) || Date.now() - lastAccessMs > 5 * 60 * 1000) {
    await execute(env.DB, 'UPDATE sesiones SET ultimo_acceso = ? WHERE id = ?', [nowISO(), session.id]);
  }

  return {
    authenticated: true,
    session,
    policy,
  };
}

export async function requireAdmin(request, env, requestUrl) {
  const adminId = getAdminGithubId(env);
  if (!adminId) {
    return {
      ok: false,
      response: errorResponse(
        'El servidor aún no tiene configurado ADMIN_GITHUB_ID.',
        503,
        'ADMIN_NOT_CONFIGURED'
      ),
    };
  }

  const resolved = await resolveSession(request, env);
  if (!resolved.authenticated) {
    return {
      ok: false,
      response: errorResponse(
        resolved.expired
          ? 'Tu sesión ha expirado. Inicia sesión nuevamente con GitHub.'
          : 'Autenticación de administrador requerida para modificar datos o acceder a respaldos.',
        401,
        resolved.expired ? 'SESSION_EXPIRED' : 'UNAUTHORIZED'
      ),
    };
  }

  if (isMutatingMethod(request.method)) {
    const originErr = validateMutationOrigin(request, env, requestUrl);
    if (originErr) {
      return { ok: false, response: originErr };
    }

    const csrfHeader = request.headers.get('X-CSRF-Token') || '';
    const csrfOk = await constantTimeEqual(csrfHeader, String(resolved.session.csrf_token));
    if (!csrfOk) {
      return {
        ok: false,
        response: errorResponse(
          'Token de seguridad CSRF inválido o ausente. Recarga la página e intenta nuevamente.',
          403,
          'CSRF_INVALID'
        ),
      };
    }
  }

  return {
    ok: true,
    session: resolved.session,
    policy: resolved.policy,
  };
}

