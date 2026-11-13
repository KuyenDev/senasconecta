/**
 * Lógica central de autenticación GitHub OAuth y manejo de sesiones en D1.
 */

import { execute, queryOne } from './database.js';
import { getAdminGithubId, getCookiePolicy } from './middleware/auth.js';
import {
  constantTimeEqual,
  nowISO,
  parseCookies,
  randomToken,
  serializeCookie,
  sha256Hex,
} from './utils.js';

const OAUTH_BIND_COOKIE = 'sc_oauth_bind';
const OAUTH_TTL_SECONDS = 600;

function getFrontendRedirectUrl(env, queryParams = {}) {
  const raw = String(env.FRONTEND_URL || '').trim();
  const url = new URL(raw);
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function redirectWithCookies(location, cookies = []) {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(null, { status: 302, headers });
}

function clearOAuthBindCookie(isHttps) {
  return serializeCookie(OAUTH_BIND_COOKIE, '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    secure: isHttps,
    sameSite: 'Lax',
  });
}

export function validateOAuthConfig(env) {
  const missing = [];
  if (!String(env.GITHUB_CLIENT_ID || '').trim()) missing.push('GITHUB_CLIENT_ID');
  if (!String(env.GITHUB_CLIENT_SECRET || '').trim()) missing.push('GITHUB_CLIENT_SECRET');
  if (!getAdminGithubId(env)) missing.push('ADMIN_GITHUB_ID');
  try {
    new URL(String(env.FRONTEND_URL || '').trim());
  } catch {
    missing.push('FRONTEND_URL');
  }
  return { ok: missing.length === 0, missing };
}

export async function startGithubLogin(request, env) {
  const configCheck = validateOAuthConfig(env);
  if (!configCheck.ok) {
    return new Response(
      JSON.stringify({
        error: 'La configuración de autenticación OAuth en el Worker está incompleta.',
        code: 'OAUTH_NOT_CONFIGURED',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const requestUrl = new URL(request.url);
  const isHttps = requestUrl.protocol === 'https:';
  const callbackPath = requestUrl.pathname.endsWith('/login')
    ? `${requestUrl.pathname.slice(0, -'/login'.length)}/callback`
    : '/auth/callback';
  const redirectUri = `${requestUrl.origin}${callbackPath}`;

  const state = randomToken(32);
  const bindNonce = randomToken(32);
  const [stateHash, bindHash] = await Promise.all([sha256Hex(state), sha256Hex(bindNonce)]);

  const now = nowISO();
  const expiration = new Date(Date.now() + OAUTH_TTL_SECONDS * 1000).toISOString();

  await execute(env.DB, 'DELETE FROM oauth_states WHERE expiracion <= ?', [now]);
  await execute(
    env.DB,
    'INSERT INTO oauth_states (state_hash, bind_hash, expiracion, fecha_creacion) VALUES (?, ?, ?, ?)',
    [stateHash, bindHash, expiration, now]
  );

  const oauthBase = String(env.GITHUB_OAUTH_BASE || 'https://github.com').replace(/\/+$/, '');
  const authorizeUrl = new URL(`${oauthBase}/login/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', String(env.GITHUB_CLIENT_ID).trim());
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'read:user');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('allow_signup', 'false');

  const bindCookie = serializeCookie(OAUTH_BIND_COOKIE, bindNonce, {
    maxAge: OAUTH_TTL_SECONDS,
    path: '/',
    httpOnly: true,
    secure: isHttps,
    sameSite: 'Lax',
  });

  return redirectWithCookies(authorizeUrl.toString(), [bindCookie]);
}

export async function handleGithubCallback(request, env) {
  const configCheck = validateOAuthConfig(env);
  if (!configCheck.ok) {
    return new Response(
      JSON.stringify({
        error: 'Configuración OAuth incompleta en el servidor.',
        code: 'OAUTH_NOT_CONFIGURED',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const requestUrl = new URL(request.url);
  const isHttps = requestUrl.protocol === 'https:';
  const clearBind = clearOAuthBindCookie(isHttps);

  const oauthError = requestUrl.searchParams.get('error');
  if (oauthError) {
    const code = oauthError === 'access_denied' ? 'cancelled' : 'oauth_failed';
    return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: code }), [clearBind]);
  }

  const code = requestUrl.searchParams.get('code') || '';
  const state = requestUrl.searchParams.get('state') || '';
  if (!code || !state || code.length > 512 || state.length > 512) {
    return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'invalid_state' }), [clearBind]);
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const bindNonce = cookies[OAUTH_BIND_COOKIE] || '';
  if (!bindNonce) {
    return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'invalid_state' }), [clearBind]);
  }

  const [stateHash, bindHash] = await Promise.all([sha256Hex(state), sha256Hex(bindNonce)]);
  const stateRow = await queryOne(
    env.DB,
    'SELECT state_hash, bind_hash, expiracion FROM oauth_states WHERE state_hash = ?',
    [stateHash]
  );

  // Consumo atómico de un solo uso antes de intercambiar el código OAuth
  const deleteResult = await execute(
    env.DB,
    'DELETE FROM oauth_states WHERE state_hash = ?',
    [stateHash]
  );
  const deletedCount = Number(deleteResult?.meta?.changes ?? deleteResult?.changes ?? 0);

  if (!stateRow || deletedCount !== 1) {
    return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'invalid_state' }), [clearBind]);
  }

  const stateExpires = Date.parse(stateRow.expiracion);
  const bindMatches = await constantTimeEqual(String(stateRow.bind_hash), bindHash);
  if (!Number.isFinite(stateExpires) || stateExpires <= Date.now() || !bindMatches) {
    return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'invalid_state' }), [clearBind]);
  }

  const oauthBase = String(env.GITHUB_OAUTH_BASE || 'https://github.com').replace(/\/+$/, '');
  const apiBase = String(env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
  const redirectUri = `${requestUrl.origin}${requestUrl.pathname}`;

  let accessToken = '';
  try {
    const tokenRes = await fetch(`${oauthBase}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'SenasConecta-Worker/1.0',
      },
      body: JSON.stringify({
        client_id: String(env.GITHUB_CLIENT_ID).trim(),
        client_secret: String(env.GITHUB_CLIENT_SECRET).trim(),
        code,
        redirect_uri: redirectUri,
        state,
      }),
    });

    if (!tokenRes.ok) {
      return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'token_exchange_failed' }), [clearBind]);
    }

    const tokenJson = await tokenRes.json();
    accessToken = String(tokenJson?.access_token || '');
    if (!accessToken) {
      return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'token_exchange_failed' }), [clearBind]);
    }
  } catch {
    return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'github_unreachable' }), [clearBind]);
  }

  let githubUser = null;
  try {
    const userRes = await fetch(`${apiBase}/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'SenasConecta-Worker/1.0',
      },
    });
    // Descartar referencia al token OAuth inmediatamente después de consultar identidad
    accessToken = '';

    if (!userRes.ok) {
      return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'github_user_failed' }), [clearBind]);
    }
    githubUser = await userRes.json();
  } catch {
    accessToken = '';
    return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'github_unreachable' }), [clearBind]);
  }

  const adminId = getAdminGithubId(env);
  const receivedId = githubUser && githubUser.id !== undefined && githubUser.id !== null ? String(githubUser.id) : '';
  const isAuthorizedAdmin = Boolean(adminId && receivedId && (await constantTimeEqual(receivedId, adminId)));

  if (!isAuthorizedAdmin) {
    return redirectWithCookies(getFrontendRedirectUrl(env, { auth_error: 'unauthorized' }), [clearBind]);
  }

  // Crear sesión segura almacenando únicamente el hash SHA-256 del token
  const sessionId = crypto.randomUUID();
  const sessionToken = randomToken(32);
  const csrfToken = randomToken(32);
  const tokenHash = await sha256Hex(sessionToken);

  const ttlHours = Math.max(1, Math.min(168, Number(env.SESSION_TTL_HOURS || 12) || 12));
  const ttlSeconds = Math.floor(ttlHours * 3600);
  const now = nowISO();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  await execute(env.DB, 'DELETE FROM sesiones WHERE expiracion <= ?', [now]);
  await execute(
    env.DB,
    `INSERT INTO sesiones (id, token_hash, csrf_token, github_user_id, github_login, github_name, avatar_url, expiracion, fecha_creacion, ultimo_acceso)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      tokenHash,
      csrfToken,
      adminId,
      String(githubUser.login || 'administrador').slice(0, 100),
      String(githubUser.name || githubUser.login || '').slice(0, 120),
      String(githubUser.avatar_url || '').slice(0, 300),
      expiresAt,
      now,
      now,
    ]
  );

  const policy = getCookiePolicy(request, env);
  const sessionCookie = serializeCookie(policy.name, sessionToken, {
    maxAge: ttlSeconds,
    path: '/',
    domain: policy.domain,
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
  });

  return redirectWithCookies(getFrontendRedirectUrl(env, { auth: 'ok' }), [clearBind, sessionCookie]);
}
