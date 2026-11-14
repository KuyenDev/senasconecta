/**
 * Controlador principal de SeñasConecta (versión estática JSON para GitHub Pages).
 */

import { refreshReferenceData, restorePublishedJsonData } from './api.js';
import { closeModal, openModal, showToast } from './components.js';
import { state } from './state.js';
import { clearNode, el, formatDateTime } from './utils.js';
import { renderDashboardView } from './views/dashboard.js';
import { renderEstadisticasView } from './views/estadisticas.js';
import { renderMapaView } from './views/mapa.js';
import { renderPersonasView } from './views/personas.js';
import { renderRespaldosView } from './views/respaldos.js';
import { renderTerritorioView } from './views/territorio.js';

const ROUTES = {
  dashboard: {
    title: 'Panel principal',
    subtitle: 'Grupo Señas Osorno · Resumen territorial y registros acumulados',
    render: renderDashboardView,
  },
  personas: {
    title: 'Registro de personas',
    subtitle: 'Fichas individuales, ubicación, comunicación y notas acumuladas',
    render: renderPersonasView,
  },
  territorio: {
    title: 'Localidades y sectores',
    subtitle: 'Organización territorial del Grupo Señas Osorno',
    render: renderTerritorioView,
  },
  mapa: {
    title: 'Mapa territorial',
    subtitle: 'Ubicación de personas, localidades, sectores y enlace a Google Maps',
    render: renderMapaView,
  },
  estadisticas: {
    title: 'Estadísticas',
    subtitle: 'Distribución territorial, estado y necesidades de comunicación',
    render: renderEstadisticasView,
  },
  respaldos: {
    title: 'Exportar y datos',
    subtitle: 'Descarga CSV/JSON, origen de archivos Excel y vista previa local',
    render: renderRespaldosView,
  },
};

const bootScreen = document.getElementById('boot-screen');
const appShell = document.getElementById('app-shell');
const sidebar = document.getElementById('app-sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const btnOpenSidebar = document.getElementById('btn-open-sidebar');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');
const btnRefreshView = document.getElementById('btn-refresh-view');

const dataUpdatedHint = document.getElementById('data-updated-hint');
const datasetPill = document.getElementById('dataset-pill');
const offlinePill = document.getElementById('offline-pill');
const btnInstallApp = document.getElementById('btn-install-app');
const btnInstallTopbar = document.getElementById('btn-install-topbar');
const btnUpdateApp = document.getElementById('btn-update-app');
const previewStatusBanner = document.getElementById('preview-status-banner');
const previewBannerText = document.getElementById('preview-banner-text');
const btnExitPreview = document.getElementById('btn-exit-preview');

const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const mainContent = document.getElementById('main-content');

let dataLoaded = false;

export function updateDatasetMetaUi() {
  if (dataUpdatedHint) {
    if (state.meta?.ultima_actualizacion) {
      const total = state.meta.totales?.personas ?? 0;
      dataUpdatedHint.textContent = `Actualizado: ${formatDateTime(state.meta.ultima_actualizacion)} · ${total} persona(s)`;
    } else {
      dataUpdatedHint.textContent = 'Base JSON lista';
    }
  }

  if (datasetPill) {
    datasetPill.textContent = state.previewMode ? 'Vista previa local' : 'Datos JSON';
  }

  if (previewStatusBanner && previewBannerText) {
    if (state.previewMode) {
      previewStatusBanner.classList.remove('hidden');
      previewBannerText.textContent = `Mostrando vista previa local en memoria (${state.previewLabel || 'archivo JSON'}). Esta vista previa no modifica los archivos publicados.`;
    } else {
      previewStatusBanner.classList.add('hidden');
      previewBannerText.textContent = '';
    }
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

  for (const btn of document.querySelectorAll('.nav-item[data-route], .mobile-nav-item')) {
    const isActive = btn.dataset.route === key;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }

  setSidebarOpen(false);
  return route;
}

function renderDataLoadError(routeName, err) {
  applyRouteShellState(routeName, false);
  clearNode(mainContent);

  const isFileProtocol = typeof window !== 'undefined' && window.location?.protocol === 'file:';
  const retryBtn = el('button', {
    type: 'button',
    className: 'btn btn-primary',
    text: 'Reintentar carga',
    onClick: async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Cargando…';
      try {
        await syncDataAndRender(state.currentRoute, false, true);
        if (dataLoaded) {
          showToast('Datos JSON cargados correctamente.', 'success');
        }
      } finally {
        retryBtn.disabled = false;
        retryBtn.textContent = 'Reintentar carga';
      }
    },
  });

  mainContent.appendChild(
    el(
      'section',
      { id: 'data-load-error-card', className: 'card', role: 'status' },
      el('div', { className: 'card-header' }, el('h2', { className: 'card-title', text: 'No se pudieron cargar los datos JSON' })),
      el(
        'div',
        { className: 'card-body', style: { display: 'grid', gap: '12px' } },
        el('p', {
          className: 'text-muted',
          text: err?.message || 'Ocurrió un error al leer los archivos en frontend/data/.',
        }),
        isFileProtocol
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
              el('code', { text: 'python3 -m http.server 8000 --directory frontend' })
            )
          : null,
        el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, retryBtn)
      )
    )
  );
}

async function navigateTo(routeName, pushHash = true) {
  const key = ROUTES[routeName] ? routeName : 'dashboard';
  if (!dataLoaded) {
    await syncDataAndRender(key, pushHash, false);
    return;
  }
  const route = applyRouteShellState(key, pushHash);
  updateDatasetMetaUi();
  await route.render(mainContent, { navigateTo, refreshMetaUi: updateDatasetMetaUi });
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
}

async function syncDataAndRender(routeName = getRouteFromHash(), pushHash = false, forceReload = false) {
  try {
    await refreshReferenceData(forceReload);
    dataLoaded = true;
    updateDatasetMetaUi();
    await navigateTo(routeName, pushHash);
    return true;
  } catch (err) {
    dataLoaded = false;
    updateDatasetMetaUi();
    renderDataLoadError(routeName, err);
    return false;
  }
}

function showAppShell() {
  bootScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
}

function isStandaloneApp() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const displayStandalone =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return Boolean(displayStandalone || nav?.standalone === true);
}

function isIosSafariBrowser() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const ua = String(nav?.userAgent || '');
  return /iPad|iPhone|iPod/i.test(ua) && typeof window !== 'undefined' && !window.MSStream && !isStandaloneApp();
}

function setInstallButtonsVisible(visible) {
  const show = Boolean(visible) && !isStandaloneApp();
  btnInstallApp?.classList?.toggle('hidden', !show);
  btnInstallTopbar?.classList?.toggle('hidden', !show);
}

function showIosInstallGuideModal() {
  const body = el(
    'div',
    { style: { display: 'grid', gap: '12px' } },
    el('p', {
      className: 'text-muted',
      text: 'En iPhone o iPad puedes instalar SeñasConecta como aplicación directa desde Safari para abrirla en pantalla completa y usarla sin conexión:',
    }),
    el(
      'ol',
      { style: { margin: 0, paddingLeft: '20px', display: 'grid', gap: '8px' } },
      el('li', { text: 'Toca el botón Compartir de Safari (cuadrado con flecha hacia arriba).' }),
      el('li', { text: 'Desliza hacia abajo y elige "Agregar a pantalla de inicio".' }),
      el('li', { text: 'Presiona "Agregar" para crear el acceso directo.' })
    )
  );
  const footer = el(
    'div',
    { style: { display: 'flex', justifyContent: 'flex-end' } },
    el('button', { type: 'button', className: 'btn btn-primary', text: 'Entendido', onClick: closeModal })
  );
  openModal({
    title: 'Instalar en iPhone / iPad',
    size: 'sm',
    body,
    footer,
  });
}

function setupConnectivityListeners() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav || typeof nav.onLine !== 'boolean') return;

  let wasOffline = !nav.onLine;
  function syncConnectivityUi(notify) {
    const online = nav.onLine !== false;
    offlinePill?.classList?.toggle('hidden', online);
    document.body?.classList?.toggle('is-offline', !online);
    if (notify) {
      if (!online) {
        showToast('Sin conexión. Consultando datos guardados en el dispositivo.', 'info');
      } else if (wasOffline) {
        showToast('Conexión restablecida.', 'success');
      }
    }
    wasOffline = !online;
  }

  syncConnectivityUi(false);
  window.addEventListener('online', () => syncConnectivityUi(true));
  window.addEventListener('offline', () => syncConnectivityUi(true));
}

function setupPwaFeatures() {
  let deferredInstallPrompt = null;
  let waitingWorker = null;
  let shouldReloadOnControllerChange = false;

  if (isIosSafariBrowser()) {
    setInstallButtonsVisible(true);
  }

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault?.();
    deferredInstallPrompt = ev;
    setInstallButtonsVisible(true);
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setInstallButtonsVisible(false);
    showToast('SeñasConecta instalada en tu dispositivo.', 'success');
  });

  async function handleInstallClick() {
    if (deferredInstallPrompt) {
      try {
        await deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (choice?.outcome === 'accepted') {
          setInstallButtonsVisible(false);
        }
      } catch {
        setInstallButtonsVisible(false);
      }
      return;
    }
    if (isIosSafariBrowser()) {
      showIosInstallGuideModal();
    }
  }

  btnInstallApp?.addEventListener('click', handleInstallClick);
  btnInstallTopbar?.addEventListener('click', handleInstallClick);

  btnUpdateApp?.addEventListener('click', () => {
    if (!waitingWorker) return;
    shouldReloadOnControllerChange = true;
    btnUpdateApp.disabled = true;
    btnUpdateApp.textContent = 'Actualizando…';
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  });

  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav || !('serviceWorker' in nav) || window.location?.protocol === 'file:') {
    return;
  }

  nav.serviceWorker.addEventListener('controllerchange', () => {
    if (shouldReloadOnControllerChange) {
      shouldReloadOnControllerChange = false;
      window.location.reload();
    }
  });

  function exposeUpdateButton(worker) {
    if (!worker) return;
    waitingWorker = worker;
    btnUpdateApp?.classList?.remove('hidden');
  }

  nav.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((registration) => {
      if (registration.waiting && nav.serviceWorker.controller) {
        exposeUpdateButton(registration.waiting);
      }
      registration.addEventListener('updatefound', () => {
        const incoming = registration.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && nav.serviceWorker.controller) {
            exposeUpdateButton(incoming);
            showToast('Hay una nueva versión disponible. Pulsa "Actualizar app".', 'info');
          }
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          registration.update().catch(() => {});
        }
      });
    })
    .catch(() => {});
}

function bindEvents() {
  for (const btn of document.querySelectorAll('.nav-item[data-route], .mobile-nav-item')) {
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
    const ok = await syncDataAndRender(state.currentRoute, false, !state.previewMode);
    if (ok) {
      showToast('Información actualizada.', 'success');
    }
  });

  btnExitPreview?.addEventListener('click', async () => {
    await restorePublishedJsonData();
    dataLoaded = true;
    updateDatasetMetaUi();
    await navigateTo(state.currentRoute, false);
    showToast('Volviste a los datos publicados en JSON.', 'info');
  });
}

async function bootstrap() {
  bindEvents();
  setupConnectivityListeners();
  setupPwaFeatures();
  showAppShell();
  await syncDataAndRender(getRouteFromHash(), false, false);
}

bootstrap().catch((err) => {
  dataLoaded = false;
  showAppShell();
  renderDataLoadError(getRouteFromHash(), err);
});
