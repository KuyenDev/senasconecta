/**
 * Vista del módulo de Mapa Territorial (filtros territoriales por localidad/sector + Leaflet/OSM opcional).
 */

import { apiFetch } from '../api.js';
import { openLocalidadFormModal, renderLoading, showToast } from '../components.js';
import { state } from '../state.js';
import { clearNode, createBadge, el } from '../utils.js';

let leafletLoadPromise = null;

function loadLeafletAssets() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoadPromise) return leafletLoadPromise;

  leafletLoadPromise = new Promise((resolve, reject) => {
    const cssId = 'senasconecta-leaflet-css';
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (window.L) resolve(window.L);
      else reject(new Error('No se pudo inicializar Leaflet.'));
    };
    script.onerror = () => {
      leafletLoadPromise = null;
      reject(new Error('No fue posible cargar Leaflet/OpenStreetMap (sin conexión o bloqueado). El sistema funciona normalmente con los filtros territoriales.'));
    };
    document.body.appendChild(script);
  });

  return leafletLoadPromise;
}

export async function renderMapaView(container, { navigateTo }) {
  clearNode(container);
  container.appendChild(renderLoading('Cargando información territorial…'));

  let localidades = [];
  try {
    const res = await apiFetch('/api/localidades?incluir_inactivas=0');
    localidades = res.items || [];
  } catch (err) {
    clearNode(container);
    container.appendChild(el('div', { className: 'alert alert-error', text: err.message }));
    return;
  }

  clearNode(container);

  container.appendChild(
    el(
      'div',
      { className: 'alert alert-info' },
      'Resguardo de privacidad territorial: aquí se muestran únicamente localidades y sectores generales. No se solicitan, almacenan ni grafican domicilios exactos ni coordenadas personales.'
    )
  );

  const withCoords = localidades.filter(
    (l) => l.latitud !== null && l.latitud !== undefined && l.longitud !== null && l.longitud !== undefined
  );
  const withoutCoords = localidades.filter((l) => !withCoords.includes(l));

  // Sección de filtros territoriales (siempre disponible sin depender de mapa)
  let selectedLocId = '';
  let sectorQuery = '';

  const selLoc = el(
    'select',
    { id: 'map-filter-loc', className: 'select' },
    el('option', { value: '', text: 'Todas las localidades activas' }),
    localidades.map((l) => el('option', { value: String(l.id), text: `${l.nombre} (${l.personas_count || 0})` }))
  );

  const inSector = el('input', {
    id: 'map-filter-sector',
    type: 'search',
    className: 'input',
    placeholder: 'Filtrar por nombre de sector o barrio…',
  });

  const toolbar = el(
    'section',
    { className: 'toolbar', ariaLabel: 'Filtros territoriales' },
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'map-filter-loc', text: 'Localidad' }), selLoc),
    el('div', { className: 'field field-grow' }, el('label', { className: 'field-label', for: 'map-filter-sector', text: 'Sector o barrio' }), inSector)
  );

  const cardsGrid = el('div', { className: 'grid-3' });

  function renderTerritoryCards() {
    clearNode(cardsGrid);
    const filtered = localidades.filter((l) => {
      if (selectedLocId && String(l.id) !== selectedLocId) return false;
      if (sectorQuery) {
        const q = sectorQuery.toLowerCase();
        const nameMatch = l.nombre.toLowerCase().includes(q);
        const secMatch = (l.sectores || []).some((s) => s.nombre.toLowerCase().includes(q));
        return nameMatch || secMatch;
      }
      return true;
    });

    if (!filtered.length) {
      cardsGrid.appendChild(
        el('p', { className: 'field-hint', text: 'No hay localidades o sectores que coincidan con el filtro.' })
      );
      return;
    }

    for (const loc of filtered) {
      const hasCoord = loc.latitud !== null && loc.longitud !== null;
      cardsGrid.appendChild(
        el(
          'article',
          { className: 'territory-card' },
          el(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' } },
            el(
              'div',
              {},
              el('h3', { className: 'card-title', text: loc.nombre }),
              loc.region ? el('p', { className: 'activity-meta', text: loc.region }) : null
            ),
            createBadge(`${loc.personas_count || 0} reg.`, 'badge-gold')
          ),
          el(
            'div',
            { className: 'activity-meta' },
            `${loc.confirmados_count || 0} confirmados · ${loc.seguimientos_pendientes_count || 0} seguimientos pendientes`
          ),
          loc.sectores?.length
            ? el(
                'div',
                {},
                el('div', { className: 'field-label', style: { marginBottom: '6px' }, text: 'Sectores informados:' }),
                el(
                  'div',
                  { className: 'chip-group' },
                  loc.sectores.map((sec) =>
                    el('button', {
                      type: 'button',
                      className: 'chip-btn',
                      text: `${sec.nombre} (${sec.total})`,
                      onClick: () => {
                        state.personasFilterPreset = { localidad_id: String(loc.id), q: sec.nombre };
                        navigateTo('personas');
                      },
                    })
                  )
                )
              )
            : el('p', { className: 'field-hint', text: 'Aún no hay sectores registrados en esta localidad.' }),
          el(
            'div',
            { style: { marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '8px', borderTop: '1px solid #eee8d8' } },
            el('span', {
              className: 'field-hint',
              text: hasCoord ? `Centro ref.: ${loc.latitud}, ${loc.longitud}` : 'Sin coordenadas referenciales',
            }),
            el(
              'div',
              { className: 'row-actions' },
              state.authenticated
                ? el('button', {
                    type: 'button',
                    className: 'btn btn-outline btn-xs',
                    text: hasCoord ? 'Ajustar centro' : 'Definir centro',
                    onClick: () => openLocalidadFormModal(loc, () => renderMapaView(container, { navigateTo })),
                  })
                : null,
              el('button', {
                type: 'button',
                className: 'btn btn-secondary btn-xs',
                text: 'Ver personas',
                onClick: () => {
                  state.personasFilterPreset = { localidad_id: String(loc.id) };
                  navigateTo('personas');
                },
              })
            )
          )
        )
      );
    }
  }

  selLoc.addEventListener('change', () => {
    selectedLocId = selLoc.value;
    renderTerritoryCards();
  });
  inSector.addEventListener('input', () => {
    sectorQuery = inSector.value.trim();
    renderTerritoryCards();
  });

  renderTerritoryCards();

  // Sección opcional de Leaflet + OpenStreetMap
  const mapHost = el('div', { id: 'leaflet-map-host', className: 'map-canvas-box hidden' });
  const mapStatus = el('div', { className: 'alert alert-warning hidden' });

  const btnEnableMap = el('button', {
    type: 'button',
    className: 'btn btn-primary btn-sm',
    text: 'Activar mapa interactivo (OpenStreetMap)',
  });

  btnEnableMap.addEventListener('click', async () => {
    if (!withCoords.length) {
      mapStatus.textContent = state.authenticated
        ? 'Ninguna localidad tiene coordenadas referenciales configuradas todavía. Define el centro aproximado de al menos una localidad (por ejemplo desde "Definir centro" arriba) para visualizarla en el mapa sin inventar ubicaciones.'
        : 'Ninguna localidad tiene coordenadas referenciales configuradas todavía. El administrador puede definir el centro aproximado de cada localidad para habilitar su visualización en el mapa.';
      mapStatus.classList.remove('hidden');
      return;
    }

    btnEnableMap.disabled = true;
    btnEnableMap.textContent = 'Cargando mapa…';
    mapStatus.classList.add('hidden');

    try {
      const L = await loadLeafletAssets();
      mapHost.classList.remove('hidden');
      clearNode(mapHost);

      const first = withCoords[0];
      const map = L.map(mapHost).setView([Number(first.latitud), Number(first.longitud)], 9);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 16,
      }).addTo(map);

      const bounds = [];
      for (const loc of withCoords) {
        const lat = Number(loc.latitud);
        const lng = Number(loc.longitud);
        bounds.push([lat, lng]);

        const marker = L.circleMarker([lat, lng], {
          radius: Math.min(22, Math.max(9, 8 + Number(loc.personas_count || 0) * 1.5)),
          color: '#163024',
          fillColor: '#496343',
          fillOpacity: 0.72,
          weight: 2,
        }).addTo(map);

        // Contenido seguro sin HTML crudo
        const popupEl = el(
          'div',
          {},
          el('strong', { text: loc.nombre }),
          el('div', { text: `Personas registradas: ${loc.personas_count || 0}` }),
          loc.sectores?.length
            ? el('div', { text: `Sectores: ${loc.sectores.map((s) => s.nombre).join(', ')}` })
            : null
        );
        marker.bindPopup(popupEl);
      }

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [36, 36] });
      }

      btnEnableMap.textContent = 'Mapa OpenStreetMap activo';
    } catch (err) {
      btnEnableMap.disabled = false;
      btnEnableMap.textContent = 'Reintentar mapa OpenStreetMap';
      mapStatus.textContent = err.message;
      mapStatus.classList.remove('hidden');
      showToast('Mapa no disponible; usa los filtros territoriales.', 'info');
    }
  });

  const optionalMapCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: 'Mapa referencial de localidades (opcional)' }),
        el('p', {
          className: 'card-subtitle',
          text: `${withCoords.length} localidades con centro referencial configurado · ${withoutCoords.length} sin coordenadas (visibles en tarjetas y filtros)`,
        })
      ),
      btnEnableMap
    ),
    el('div', { className: 'card-body' }, mapStatus, mapHost, !withCoords.length ? el('p', { className: 'field-hint', text: 'Las localidades sin coordenadas no se ubican automáticamente para evitar inventar ubicaciones. Puedes usar todos los filtros territoriales sin necesidad de cargar un mapa externo.' }) : null)
  );

  container.appendChild(toolbar);
  container.appendChild(
    el(
      'section',
      { className: 'card' },
      el(
        'div',
        { className: 'card-header' },
        el('h2', { className: 'card-title', text: 'Localidades y sectores territoriales' })
      ),
      el('div', { className: 'card-body' }, cardsGrid)
    )
  );
  container.appendChild(optionalMapCard);
}

