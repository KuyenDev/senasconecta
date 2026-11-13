/**
 * Controlador principal de SeñasConecta (versión estática JSON para GitHub Pages).
 */

import { refreshReferenceData, restorePublishedJsonData } from './api.js';
import { showToast } from './components.js';
import { state } from './state.js';
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

  for (const btn of document.querySelectorAll('.nav-item[data-route]')) {
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

function bindEvents() {
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
  showAppShell();
  await syncDataAndRender(getRouteFromHash(), false, false);
}

bootstrap().catch((err) => {
  dataLoaded = false;
  showAppShell();
  renderDataLoadError(getRouteFromHash(), err);
});
