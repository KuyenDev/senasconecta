/**
 * Rutas de autenticación y estado de sesión para SeñasConecta.
 */

import { execute } from '../database.js';
import { handleGithubCallback, startGithubLogin, validateOAuthConfig } from '../auth.js';
import { getCookiePolicy, requireAdmin, resolveSession } from '../middleware/auth.js';
import { enforceRateLimit } from '../middleware/rateLimit.js';
import { jsonResponse, serializeCookie } from '../utils.js';

export async function handleAuthRoutes(request, env, requestUrl) {
  const path = requestUrl.pathname;

  if (request.method === 'GET' && (path === '/auth/login' || path === '/api/auth/login')) {
    const rateErr = await enforceRateLimit(request, env, 'auth');
    if (rateErr) return rateErr;
    return await startGithubLogin(request, env);
  }

  if (request.method === 'GET' && (path === '/auth/callback' || path === '/api/auth/callback')) {
    const rateErr = await enforceRateLimit(request, env, 'auth');
    if (rateErr) return rateErr;
    return await handleGithubCallback(request, env);
  }

  if (request.method === 'GET' && path === '/api/auth/session') {
    const rateErr = await enforceRateLimit(request, env, 'api');
    if (rateErr) return rateErr;

    const oauthCheck = validateOAuthConfig(env);
    const resolved = await resolveSession(request, env);

    if (!resolved.authenticated) {
      return jsonResponse({
        authenticated: false,
        oauth_configured: oauthCheck.ok,
      });
    }

    return jsonResponse({
      authenticated: true,
      oauth_configured: oauthCheck.ok,
      admin: {
        login: resolved.session.github_login,
        name: resolved.session.github_name || resolved.session.github_login,
        avatar_url: resolved.session.avatar_url || '',
      },
      csrf_token: resolved.session.csrf_token,
      expires_at: resolved.session.expiracion,
      cookie_mode: resolved.policy.mode,
    });
  }

  if (request.method === 'POST' && path === '/api/auth/logout') {
    const auth = await requireAdmin(request, env, requestUrl);
    if (!auth.ok) return auth.response;

    await execute(env.DB, 'DELETE FROM sesiones WHERE id = ?', [auth.session.id]);

    const policy = getCookiePolicy(request, env);
    const clearCookie = serializeCookie(policy.name, '', {
      maxAge: 0,
      path: '/',
      domain: policy.domain,
      httpOnly: true,
      secure: policy.secure,
      sameSite: policy.sameSite,
    });

    return jsonResponse(
      { ok: true, message: 'Sesión cerrada correctamente.' },
      200,
      { 'Set-Cookie': clearCookie }
    );
  }

  return null;
}

