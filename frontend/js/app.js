/**
 * Controlador principal de SeñasConecta: inicialización, rutas, barra lateral y sesión.
 */

import { refreshReferenceData, setUnauthorizedHandler } from './api.js';
import {
  checkSessionStatus,
  consumeUrlAuthFeedback,
  getAuthErrorMessage,
  performLogout,
  startLoginRedirect,
} from './auth.js';
import { closeModal, openPersonFormModal, showToast } from './components.js';
import { resetAuthState, state } from './state.js';
import { clearNode, el, formatDateTime } from './utils.js';
import { renderDashboardView } from './views/dashboard.js';
import { renderEstadisticasView } from './views/estadisticas.js';
import { renderMapaView } from './views/mapa.js';
import { renderPersonasView } from './views/personas.js';
import { renderRespaldosView } from './views/respaldos.js';
import { renderSeguimientosView } from './views/seguimientos.js';
import { renderTerritorioView } from './views/territorio.js';

const ROUTES = {
  dashboard: {
    title: 'Panel principal',
    subtitle: 'Grupo Señas Osorno · Resumen territorial y actividad reciente',
    render: renderDashboardView,
  },
  personas: {
    title: 'Registro de personas',
    subtitle: 'Fichas individuales, comunicación y filtros territoriales',
    render: renderPersonasView,
  },
  territorio: {
    title: 'Localidades y sectores',
    subtitle: 'Organización territorial del Grupo Señas Osorno',
    render: renderTerritorioView,
  },
  seguimientos: {
    title: 'Seguimiento territorial',
    subtitle: 'Visitas, confirmaciones e interpretaciones pendientes',
    render: renderSeguimientosView,
  },
  mapa: {
    title: 'Mapa territorial',
    subtitle: 'Localidades, sectores y mapa opcional OpenStreetMap',
    render: renderMapaView,
  },
  estadisticas: {
    title: 'Estadísticas',
    subtitle: 'Distribución territorial, estado y necesidades de comunicación',
    render: renderEstadisticasView,
  },
  respaldos: {
    title: 'Respaldos y seguridad',
    subtitle: 'Exportación CSV/JSON, importación validada y estado de sesión',
    render: renderRespaldosView,
  },
};

const bootScreen = document.getElementById('boot-screen');
const appShell = document.getElementById('app-shell');
const sidebar = document.getElementById('app-sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const btnOpenSidebar = document.getElementById('btn-open-sidebar');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');

const guestSidebarPanel = document.getElementById('guest-sidebar-panel');
const adminSidebarPanel = document.getElementById('admin-sidebar-panel');
const btnGithubLogin = document.getElementById('btn-github-login');
const btnTopbarLogin = document.getElementById('btn-topbar-login');
const readonlyPill = document.getElementById('readonly-pill');
const btnLogout = document.getElementById('btn-logout');
const btnRefreshView = document.getElementById('btn-refresh-view');
const btnQuickNewPerson = document.getElementById('btn-quick-new-person');

const authStatusBanner = document.getElementById('auth-status-banner');
const authBannerText = document.getElementById('auth-banner-text');
const btnCloseAuthBanner = document.getElementById('btn-close-auth-banner');

const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const mainContent = document.getElementById('main-content');
let backendReachable = false;

function showAuthBanner(message, variant = 'error') {
  if (!authStatusBanner || !authBannerText) return;
  authStatusBanner.className = `auth-banner auth-banner-${variant}`;
  authBannerText.textContent = message;
}

function clearAuthBanner() {
  if (!authStatusBanner || !authBannerText) return;
  authStatusBanner.className = 'auth-banner hidden';
  authBannerText.textContent = '';
}

function updateAdminIndicator() {
  const avatarEl = document.getElementById('admin-avatar');
  const nameEl = document.getElementById('admin-display-name');
  const handleEl = document.getElementById('admin-login-handle');
  const expiryEl = document.getElementById('session-expiry-hint');

  const admin = state.admin || { login: 'admin', name: 'Administrador', avatar_url: '' };
  nameEl.textContent = admin.name || admin.login;
  handleEl.textContent = `@${admin.login}`;

  clearNode(avatarEl);
  if (admin.avatar_url && /^https?:\/\//i.test(admin.avatar_url)) {
    avatarEl.appendChild(
      el('img', { src: admin.avatar_url, alt: `Avatar de ${admin.login}`, referrerpolicy: 'no-referrer' })
    );
  } else {
    const initials = (admin.name || admin.login || 'AD').slice(0, 2).toUpperCase();
    avatarEl.textContent = initials;
  }

  expiryEl.textContent = state.expiresAt
    ? `Sesión válida hasta ${formatDateTime(state.expiresAt)}`
    : '';
}

function updateAuthUi() {
  const isAdmin = Boolean(state.authenticated);
  guestSidebarPanel?.classList.toggle('hidden', isAdmin);
  adminSidebarPanel?.classList.toggle('hidden', !isAdmin);
  readonlyPill?.classList.toggle('hidden', isAdmin);
  btnTopbarLogin?.classList.toggle('hidden', isAdmin);
  btnQuickNewPerson?.classList.toggle('hidden', !isAdmin);
  if (isAdmin) {
    updateAdminIndicator();
  }
}

function handleLoginTrigger() {
  if (!backendReachable) {
    showAuthBanner(getAuthErrorMessage('network'), 'warning');
    return;
  }
  if (!state.oauthConfigured) {
    showAuthBanner(
      'Aviso de configuración: la autenticación GitHub OAuth aún no está completada en el servidor.',
      'warning'
    );
    return;
  }
  const res = startLoginRedirect();
  if (!res.ok) {
    showAuthBanner(getAuthErrorMessage(res.errorCode), 'error');
  }
}

function setSidebarOpen(isOpen) {
  sidebar.classList.toggle('open', isOpen);
  sidebarBackdrop.classList.toggle('hidden', !isOpen);
  btnOpenSidebar.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  return ROUTES[raw] ? raw : 'dashboard';
}

function applyRouteShellState(routeName, pushHash = true) {
  const key = ROUTES[routeName] ? routeName : 'dashboard';
  state.currentRoute = key;
  if (pushHash && window.location.hash !== `#${key}`) {
    window.location.hash = `#${key}`;
  }

  const route = ROUTES[key];
  pageTitle.textContent = route.title;
  pageSubtitle.textContent = route.subtitle;

  for (const btn of document.querySelectorAll('.nav-item[data-route]')) {
    const isActive = btn.dataset.route === key;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }

  setSidebarOpen(false);
  return route;
}

function renderBackendOfflineState(routeName, errorCode = 'network') {
  applyRouteShellState(routeName, false);
  clearNode(mainContent);

  const host = String(window.location.hostname || '').trim();
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);

  const retryBtn = el('button', {
    type: 'button',
    className: 'btn btn-primary',
    text: 'Reintentar conexión',
    onClick: async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Conectando…';
      try {
        const status = await syncAppDataAndRender(state.currentRoute, false);
        if (!status.errorCode) {
          showToast('Conexión establecida con SeñasConecta.', 'success');
        }
      } finally {
        retryBtn.disabled = false;
        retryBtn.textContent = 'Reintentar conexión';
      }
    },
  });

  const card = el(
    'section',
    { id: 'backend-offline-card', className: 'card', role: 'status' },
    el(
      'div',
      { className: 'card-header' },
      el('h2', {
        className: 'card-title',
        text:
          errorCode === 'unconfigured'
            ? 'Configuración de Worker pendiente'
            : 'Sin conexión con la API de SeñasConecta',
      })
    ),
    el(
      'div',
      { className: 'card-body', style: { display: 'grid', gap: '12px' } },
      el('p', {
        className: 'text-muted',
        text: isLocal
          ? 'El navegador abrió los archivos estáticos, pero el Worker local aún no está encendido. Inicia el entorno local completo en la raíz del proyecto:'
          : getAuthErrorMessage(errorCode),
      }),
      isLocal
        ? el(
            'pre',
            {
              style: {
                margin: 0,
                padding: '12px 14px',
                borderRadius: '10px',
                background: '#f3f1ea',
                border: '1px solid #ded8c8',
                overflowX: 'auto',
                fontSize: '0.92rem',
              },
            },
            el('code', { text: 'python3 scripts/dev_local.py' })
          )
        : null,
      isLocal
        ? el('p', {
            className: 'text-muted',
            text: 'Luego presiona «Reintentar conexión» (o abre http://127.0.0.1:8080/ directamente para usar la base SQLite y el inicio de sesión local).',
          })
        : null,
      el(
        'div',
        { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
        retryBtn
      )
    )
  );

  mainContent.appendChild(card);
}

async function navigateTo(routeName, pushHash = true) {
  const key = ROUTES[routeName] ? routeName : 'dashboard';
  if (!backendReachable) {
    applyRouteShellState(key, pushHash);
    await syncAppDataAndRender(key, false);
    return;
  }
  const route = applyRouteShellState(key, pushHash);
  await route.render(mainContent, { navigateTo });
}

async function syncAppDataAndRender(routeName = getRouteFromHash(), pushHash = false) {
  const status = await checkSessionStatus();
  updateAuthUi();

  if (status.errorCode === 'network' || status.errorCode === 'unconfigured') {
    backendReachable = false;
    clearAuthBanner();
    renderBackendOfflineState(routeName, status.errorCode);
    return status;
  }

  backendReachable = true;
  try {
    await refreshReferenceData();
  } catch (err) {
    if (err?.code === 'NETWORK_ERROR' || err?.code === 'BACKEND_UNREACHABLE') {
      backendReachable = false;
      clearAuthBanner();
      renderBackendOfflineState(routeName, 'network');
      return { authenticated: false, errorCode: 'network' };
    }
    showToast(err.message || 'No se pudieron cargar las listas de referencia.', 'error');
  }

  await navigateTo(routeName, pushHash);
  return status;
}

function showAppShell() {
  bootScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  updateAuthUi();
}

function bindEvents() {
  setUnauthorizedHandler(async (code) => {
    closeModal();
    resetAuthState();
    updateAuthUi();
    await refreshReferenceData().catch(() => {});
    await navigateTo(state.currentRoute, false);
    showAuthBanner(
      getAuthErrorMessage(code === 'SESSION_EXPIRED' ? 'session_expired' : 'session_expired'),
      'warning'
    );
  });

  btnGithubLogin?.addEventListener('click', handleLoginTrigger);
  btnTopbarLogin?.addEventListener('click', handleLoginTrigger);
  btnCloseAuthBanner?.addEventListener('click', clearAuthBanner);

  btnLogout.addEventListener('click', async () => {
    btnLogout.disabled = true;
    try {
      await performLogout();
    } finally {
      btnLogout.disabled = false;
      updateAuthUi();
      await refreshReferenceData().catch(() => {});
      await navigateTo(state.currentRoute, false);
      showToast('Sesión cerrada. Continúas en modo lectura.', 'info');
    }
  });

  for (const btn of document.querySelectorAll('.nav-item[data-route]')) {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.route);
    });
  }

  window.addEventListener('hashchange', () => {
    navigateTo(getRouteFromHash(), false);
  });

  btnOpenSidebar.addEventListener('click', () => setSidebarOpen(true));
  btnCloseSidebar.addEventListener('click', () => setSidebarOpen(false));
  sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));

  btnRefreshView.addEventListener('click', async () => {
    const status = await syncAppDataAndRender(state.currentRoute, false);
    if (!status.errorCode) {
      clearAuthBanner();
      showToast('Información actualizada.', 'success');
    }
  });

  btnQuickNewPerson.addEventListener('click', () => {
    if (!state.authenticated) return;
    openPersonFormModal(null, () => {
      navigateTo(state.currentRoute, false);
    });
  });
}

async function bootstrap() {
  bindEvents();
  const { authResult, authError } = consumeUrlAuthFeedback();

  showAppShell();
  const status = await syncAppDataAndRender(getRouteFromHash(), false);

  if (status.authenticated && authResult === 'ok') {
    clearAuthBanner();
    showToast('Sesión de administrador iniciada correctamente.', 'success');
  } else if (authError) {
    showAuthBanner(getAuthErrorMessage(authError), 'error');
  } else if (authResult === 'ok' && !status.errorCode && !status.authenticated) {
    showAuthBanner(getAuthErrorMessage('cookie_blocked'), 'error');
  } else if (status.errorCode && status.errorCode !== 'network' && status.errorCode !== 'unconfigured') {
    showAuthBanner(getAuthErrorMessage(status.errorCode), 'error');
  }
}

bootstrap().catch(() => {
  backendReachable = false;
  showAppShell();
  clearAuthBanner();
  renderBackendOfflineState(getRouteFromHash(), 'network');
});
