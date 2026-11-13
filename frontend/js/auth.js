/**
 * Gestión del flujo de autenticación con GitHub OAuth (único administrador) y cookies seguras.
 */

import { apiFetch, buildApiUrl } from './api.js';
import { isApiUrlConfigured } from './config.js';
import { resetAuthState, state } from './state.js';

const AUTH_ERROR_MESSAGES = {
  unauthorized:
    'Acceso denegado: la cuenta de GitHub autenticada no corresponde al administrador autorizado de SeñasConecta.',
  cancelled: 'Se canceló el inicio de sesión en GitHub.',
  invalid_state:
    'La validación de seguridad OAuth (state) expiró o no es válida. Intenta ingresar nuevamente.',
  token_exchange_failed: 'No fue posible completar el intercambio OAuth con GitHub. Intenta nuevamente.',
  github_user_failed: 'No se pudo verificar tu perfil de usuario en GitHub.',
  github_unreachable: 'No fue posible contactar a GitHub en este momento.',
  oauth_failed: 'GitHub reportó un error durante la autorización.',
  cookie_blocked:
    'Tu navegador bloqueó la cookie de sesión entre dominios distintos (por ejemplo github.io y workers.dev). Se recomienda usar un dominio personalizado bajo el mismo sitio registrable para el frontend y el Worker, o permitir cookies de terceros para el dominio de la API.',
  session_expired: 'Tu sesión expiró. Por seguridad, inicia sesión nuevamente con GitHub.',
  network:
    'No se pudo contactar con el Worker de SeñasConecta. En local ejecuta "python3 scripts/dev_local.py"; en producción revisa frontend/js/config.js.',
  server: 'El Worker de SeñasConecta respondió con un error inesperado al consultar la sesión.',
  unconfigured:
    'Falta configurar la URL del Cloudflare Worker en frontend/js/config.js antes de iniciar sesión.',
};

export function consumeUrlAuthFeedback() {
  const url = new URL(window.location.href);
  const authResult = url.searchParams.get('auth');
  const authError = url.searchParams.get('auth_error');

  if (authResult || authError) {
    url.searchParams.delete('auth');
    url.searchParams.delete('auth_error');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  return { authResult, authError };
}

export function getAuthErrorMessage(code) {
  return AUTH_ERROR_MESSAGES[code] || 'No fue posible completar el inicio de sesión.';
}

export async function checkSessionStatus() {
  if (!isApiUrlConfigured()) {
    resetAuthState();
    return { authenticated: false, errorCode: 'unconfigured' };
  }

  try {
    const data = await apiFetch('/api/auth/session', { skipAuthRedirect: true });
    state.oauthConfigured = data.oauth_configured !== false;

    if (data.authenticated) {
      state.authenticated = true;
      state.admin = data.admin || null;
      state.csrfToken = data.csrf_token || null;
      state.expiresAt = data.expires_at || null;
      state.cookieMode = data.cookie_mode || null;
      return { authenticated: true };
    }

    resetAuthState();
    return { authenticated: false };
  } catch (err) {
    resetAuthState();
    const isUnreachable =
      !err ||
      err.code === 'NETWORK_ERROR' ||
      err.code === 'BACKEND_UNREACHABLE' ||
      err.status === 0;
    return { authenticated: false, errorCode: isUnreachable ? 'network' : 'server' };
  }
}

export function startLoginRedirect() {
  if (!isApiUrlConfigured()) {
    return { ok: false, errorCode: 'unconfigured' };
  }
  window.location.assign(buildApiUrl('/auth/login'));
  return { ok: true };
}

export async function performLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST', skipAuthRedirect: true });
  } finally {
    resetAuthState();
  }
}

