/**
 * Estado en memoria de SeñasConecta.
 * No almacena tokens ni datos personales en localStorage/sessionStorage.
 */

export const state = {
  authenticated: false,
  oauthConfigured: true,
  admin: null,
  csrfToken: null,
  expiresAt: null,
  cookieMode: null,

  currentRoute: 'dashboard',
  categorias: {},
  localidades: [],
  congregaciones: [],

  // Filtros preaplicados al navegar desde otros módulos (ej. mapa -> personas)
  personasFilterPreset: null,
};

export function resetAuthState() {
  state.authenticated = false;
  state.admin = null;
  state.csrfToken = null;
  state.expiresAt = null;
  state.cookieMode = null;
  state.localidades = [];
  state.congregaciones = [];
}

