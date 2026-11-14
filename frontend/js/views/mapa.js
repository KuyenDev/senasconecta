/**
 * Vista del módulo de Mapa Territorial:
 * - Filtros por localidad, estado y sector/nombre.
 * - Mapa interactivo gratuito (Leaflet con vista calles OSM y satélite) con marcadores de cada persona.
 * - Acceso directo para abrir cada ubicación en Google Maps o ver la ficha completa.
 */

import { apiFetch } from '../api.js';
import { openPersonDetailModal, renderLoading, showToast } from '../components.js';
import { normalizeText } from '../dataStore.js';
import { state } from '../state.js';
import {
  buildGoogleMapsUrl,
  clearNode,
  createBadge,
  el,
  fullName,
  getCategoryLabel,
  getStatusBadgeClass,
  hasCoords,
  triBoolLabel,
} from '../utils.js';

let leafletLoadPromise = null;

const STATUS_MARKER_STYLE = {
  confirmado: { fill: '#2e6f40', label: 'Confirmado' },
  pendiente_actualizacion: { fill: '#c6932d', label: 'Pendiente / Por confirmar' },
  por_confirmar: { fill: '#c6932d', label: 'Pendiente / Por confirmar' },
  requiere_visita: { fill: '#b84a39', label: 'Requiere visita' },
  inactivo: { fill: '#6b7280', label: 'Inactivo / Trasladado' },
};

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
      reject(
        new Error(
          'No fue posible cargar el mapa gratuito (sin conexión o bloqueado). Puedes seguir usando las tarjetas y enlaces a Google Maps.'
        )
      );
    };
    document.body.appendChild(script);
  });

  return leafletLoadPromise;
}

async function fetchAllPersonas() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await apiFetch(`/api/personas?page=${page}&limit=1000&sort=nombre&order=asc`);
    const chunk = Array.isArray(res.items) ? res.items : [];
    all.push(...chunk);
    if (all.length >= Number(res.total || 0) || !chunk.length) break;
    page += 1;
  }
  return all;
}

function getMarkerStyle(estado) {
  return STATUS_MARKER_STYLE[estado] || STATUS_MARKER_STYLE.por_confirmar;
}

export async function renderMapaView(container, { navigateTo }) {
  clearNode(container);
  container.appendChild(renderLoading('Cargando información territorial y ubicaciones…'));

  let localidades = [];
  let personas = [];
  try {
    const [locRes, allPersonas] = await Promise.all([
      apiFetch('/api/localidades?incluir_inactivas=0'),
      fetchAllPersonas(),
    ]);
    localidades = locRes.items || [];
    personas = allPersonas;
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
      'Mapa territorial gratuito del Grupo Señas Osorno: activa el mapa para visualizar los marcadores de cada persona sorda (vista calles o satélite) y abrir cualquier ubicación o ruta directamente en Google Maps.'
    )
  );

  // Filtros compartidos (aplican a mapa, lista de ubicaciones y tarjetas de localidades)
  let selectedLocId = '';
  let selectedEstado = '';
  let searchQuery = '';

  const selLoc = el(
    'select',
    { id: 'map-filter-loc', className: 'select' },
    el('option', { value: '', text: 'Todas las localidades activas' }),
    localidades.map((l) => el('option', { value: String(l.id), text: `${l.nombre} (${l.personas_count || 0})` }))
  );

  const selEstado = el(
    'select',
    { id: 'map-filter-estado', className: 'select' },
    el('option', { value: '', text: 'Todos los estados' }),
    (state.categorias.estado_registro || []).map((c) => el('option', { value: c.clave, text: c.etiqueta }))
  );

  const inSearch = el('input', {
    id: 'map-filter-sector',
    type: 'search',
    className: 'input',
    placeholder: 'Filtrar por persona, sector o dirección…',
  });

  const toolbar = el(
    'section',
    { className: 'toolbar', ariaLabel: 'Filtros territoriales' },
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'map-filter-loc', text: 'Localidad' }), selLoc),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'map-filter-estado', text: 'Estado' }), selEstado),
    el('div', { className: 'field field-grow' }, el('label', { className: 'field-label', for: 'map-filter-sector', text: 'Sector, dirección o nombre' }), inSearch)
  );

  function getFilteredLocalidades() {
    const q = normalizeText(searchQuery);
    return localidades.filter((l) => {
      if (selectedLocId && String(l.id) !== selectedLocId) return false;
      if (q) {
        const nameMatch = normalizeText(l.nombre).includes(q);
        const secMatch = (l.sectores || []).some((s) => normalizeText(s.nombre).includes(q));
        return nameMatch || secMatch;
      }
      return true;
    });
  }

  function getFilteredPersonas() {
    const q = normalizeText(searchQuery);
    return personas.filter((p) => {
      if (selectedLocId && String(p.localidad_id ?? '') !== selectedLocId) return false;
      if (selectedEstado && p.estado !== selectedEstado) return false;
      if (q) {
        const haystack = normalizeText(
          `${p.codigo_interno} ${p.nombre} ${p.apellido} ${p.localidad_nombre} ${p.sector} ${p.direccion}`
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  // Contenedores dinámicos
  const mapHost = el('div', { id: 'leaflet-map-host', className: 'map-canvas-box hidden' });
  const mapStatus = el('div', { className: 'alert alert-warning hidden' });
  const mapSubtitle = el('p', { className: 'card-subtitle' });
  const mapHintEl = el('p', { className: 'field-hint', style: { marginTop: '8px' } });
  const locationsListBody = el('div', { className: 'card-body' });
  const cardsGrid = el('div', { className: 'grid-3' });

  const legend = el(
    'div',
    { className: 'map-legend', ariaLabel: 'Leyenda de colores de marcadores' },
    el('span', { className: 'map-legend-item' }, el('span', { className: 'map-legend-dot', style: { background: '#2e6f40' } }), 'Confirmado'),
    el('span', { className: 'map-legend-item' }, el('span', { className: 'map-legend-dot', style: { background: '#c6932d' } }), 'Pendiente / Por confirmar'),
    el('span', { className: 'map-legend-item' }, el('span', { className: 'map-legend-dot', style: { background: '#b84a39' } }), 'Requiere visita'),
    el('span', { className: 'map-legend-item' }, el('span', { className: 'map-legend-dot', style: { background: '#6b7280' } }), 'Inactivo')
  );

  const btnEnableMap = el('button', {
    type: 'button',
    className: 'btn btn-primary btn-sm',
    text: 'Activar mapa con marcadores (Gratuito)',
  });

  let mapInstance = null;
  let markersLayer = null;

  function renderMapMarkers() {
    if (!mapInstance || !markersLayer || !window.L) return;
    const L = window.L;
    markersLayer.clearLayers();

    const filteredPeople = getFilteredPersonas();
    const peopleWithCoords = filteredPeople.filter(hasCoords);
    const locsWithCoords = getFilteredLocalidades().filter(hasCoords);
    const bounds = [];

    // Centros referenciales de localidades como referencia suave
    for (const loc of locsWithCoords) {
      const lat = Number(loc.latitud);
      const lng = Number(loc.longitud);
      bounds.push([lat, lng]);

      const circle = L.circleMarker([lat, lng], {
        radius: 16,
        color: '#163024',
        fillColor: '#496343',
        fillOpacity: peopleWithCoords.length ? 0.14 : 0.45,
        weight: 1.5,
      });

      const locPopup = el(
        'div',
        { className: 'map-popup-card' },
        el('strong', { text: `${loc.nombre} (centro referencial)` }),
        el('div', { text: `Personas registradas: ${loc.personas_count || 0}` }),
        loc.sectores?.length
          ? el('div', { text: `Sectores: ${loc.sectores.map((s) => s.nombre).join(', ')}` })
          : null
      );
      circle.bindPopup(locPopup);
      circle.addTo(markersLayer);
    }

    // Marcadores individuales de cada persona (con micro-separación si comparten coordenada exacta)
    const coordSeenCount = new Map();
    for (const persona of peopleWithCoords) {
      const baseLat = Number(persona.latitud);
      const baseLng = Number(persona.longitud);
      const key = `${baseLat.toFixed(6)},${baseLng.toFixed(6)}`;
      const dupIndex = coordSeenCount.get(key) || 0;
      coordSeenCount.set(key, dupIndex + 1);

      let lat = baseLat;
      let lng = baseLng;
      if (dupIndex > 0) {
        const angle = (dupIndex * 2 * Math.PI) / 6;
        const offset = 0.00012 * (1 + Math.floor((dupIndex - 1) / 6));
        lat += Math.sin(angle) * offset;
        lng += Math.cos(angle) * offset;
      }

      bounds.push([lat, lng]);
      const style = getMarkerStyle(persona.estado);
      const marker = L.circleMarker([lat, lng], {
        radius: 9,
        color: '#ffffff',
        fillColor: style.fill,
        fillOpacity: 0.94,
        weight: 2.5,
      });

      const mapsUrl = buildGoogleMapsUrl(persona);
      const popupEl = el(
        'div',
        { className: 'map-popup-card' },
        el(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
          el('strong', { text: fullName(persona) }),
          createBadge(
            getCategoryLabel(state.categorias, 'estado_registro', persona.estado, persona.estado),
            getStatusBadgeClass(persona.estado)
          )
        ),
        el('div', { className: 'activity-meta', text: `${persona.codigo_interno} · ${persona.localidad_nombre}${persona.sector ? ` · ${persona.sector}` : ''}` }),
        persona.direccion ? el('div', { text: `Dirección: ${persona.direccion}` }) : null,
        el('div', {
          text: `LSCh: ${triBoolLabel(persona.usa_lsch)}${persona.medio_comunicacion ? ` · ${getCategoryLabel(state.categorias, 'medio_comunicacion', persona.medio_comunicacion)}` : ''}`,
        }),
        persona.proxima_accion ? el('div', { className: 'activity-meta', text: `Próxima acción: ${persona.proxima_accion}` }) : null,
        el(
          'div',
          { className: 'map-popup-actions' },
          el('button', {
            type: 'button',
            className: 'btn btn-secondary btn-xs',
            text: 'Ver ficha',
            onClick: () => openPersonDetailModal(persona.id),
          }),
          mapsUrl
            ? el('a', {
                href: mapsUrl,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'btn btn-primary btn-xs',
                text: 'Abrir en Google Maps',
              })
            : null
        )
      );

      marker.bindPopup(popupEl);
      marker.addTo(markersLayer);
    }

    if (bounds.length === 1) {
      mapInstance.setView(bounds[0], peopleWithCoords.length ? 15 : 11);
    } else if (bounds.length > 1) {
      mapInstance.fitBounds(bounds, { padding: [38, 38], maxZoom: 16 });
    }
  }

  function renderStatusAndHints() {
    const filteredPeople = getFilteredPersonas();
    const withPersonCoords = filteredPeople.filter(hasCoords);
    const withMapsOnly = filteredPeople.filter((p) => !hasCoords(p) && Boolean(buildGoogleMapsUrl(p)));
    const locsWithCoords = getFilteredLocalidades().filter(hasCoords);

    mapSubtitle.textContent = `${withPersonCoords.length} personas con marcador en el mapa · ${withMapsOnly.length} con enlace/dirección · ${locsWithCoords.length} centros de localidad`;

    if (!withPersonCoords.length && !locsWithCoords.length) {
      mapHintEl.textContent =
        'Para ver marcadores en el mapa, agrega columnas Latitud y Longitud o pega un Link Google Maps por persona en tus archivos de datos/.';
      mapHintEl.classList.remove('hidden');
    } else if (filteredPeople.length > withPersonCoords.length) {
      const missing = filteredPeople.length - withPersonCoords.length;
      mapHintEl.textContent = `${missing} persona(s) del filtro aún no tienen coordenadas exactas; siguen visibles en el listado inferior y en Personas.`;
      mapHintEl.classList.remove('hidden');
    } else {
      mapHintEl.classList.add('hidden');
    }
  }

  function renderUbicacionesList() {
    clearNode(locationsListBody);
    const filteredPeople = getFilteredPersonas();
    const withMaps = filteredPeople.filter((p) => Boolean(buildGoogleMapsUrl(p)));

    if (!filteredPeople.length) {
      locationsListBody.appendChild(
        el('p', { className: 'field-hint', text: 'No hay personas que coincidan con los filtros seleccionados.' })
      );
      return;
    }

    if (!withMaps.length) {
      locationsListBody.appendChild(
        el('p', {
          className: 'field-hint',
          text: 'Ninguna de las personas filtradas tiene aún Dirección, Latitud/Longitud o Link Google Maps cargado en datos/.',
        })
      );
      return;
    }

    const tbody = el(
      'tbody',
      {},
      withMaps.map((p) => {
        const mapsUrl = buildGoogleMapsUrl(p);
        const ubicText = hasCoords(p)
          ? `${p.latitud}, ${p.longitud}`
          : (p.direccion || 'Enlace guardado');
        return el(
          'tr',
          {},
          el(
            'td',
            {},
            el('strong', { text: fullName(p) }),
            el('div', { className: 'activity-meta', text: p.codigo_interno })
          ),
          el(
            'td',
            {},
            el('div', { text: p.localidad_nombre }),
            p.sector ? el('div', { className: 'activity-meta', text: p.sector }) : null
          ),
          el(
            'td',
            {},
            p.direccion ? el('div', { text: p.direccion }) : null,
            el('div', { className: 'activity-meta', text: ubicText })
          ),
          el(
            'td',
            {},
            createBadge(
              getCategoryLabel(state.categorias, 'estado_registro', p.estado, p.estado),
              getStatusBadgeClass(p.estado)
            )
          ),
          el(
            'td',
            {},
            el(
              'div',
              { className: 'row-actions' },
              el('button', {
                type: 'button',
                className: 'btn btn-secondary btn-xs',
                text: 'Ver ficha',
                onClick: () => openPersonDetailModal(p.id),
              }),
              el('a', {
                href: mapsUrl,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'btn btn-primary btn-xs',
                text: 'Google Maps',
              })
            )
          )
        );
      })
    );

    locationsListBody.appendChild(
      el(
        'div',
        { className: 'table-wrap' },
        el(
          'table',
          { className: 'data-table' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { text: 'Persona' }),
              el('th', { text: 'Localidad / Sector' }),
              el('th', { text: 'Dirección / Coordenadas' }),
              el('th', { text: 'Estado' }),
              el('th', { text: 'Acciones' })
            )
          ),
          tbody
        )
      )
    );
  }

  function renderTerritoryCards() {
    clearNode(cardsGrid);
    const filtered = getFilteredLocalidades();

    if (!filtered.length) {
      cardsGrid.appendChild(
        el('p', { className: 'field-hint', text: 'No hay localidades o sectores que coincidan con el filtro.' })
      );
      return;
    }

    for (const loc of filtered) {
      const hasCoord = hasCoords(loc);
      const locLocatedPeople = personas.filter((p) => p.localidad_id === loc.id && hasCoords(p)).length;
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
            `${loc.confirmados_count || 0} confirmados · ${locLocatedPeople} con marcador en mapa`
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
              text: hasCoord ? `Centro ref.: ${loc.latitud}, ${loc.longitud}` : 'Sin centro referencial',
            }),
            el(
              'div',
              { className: 'row-actions' },
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

  function refreshAllSections() {
    renderStatusAndHints();
    renderUbicacionesList();
    renderTerritoryCards();
    renderMapMarkers();
  }

  btnEnableMap.addEventListener('click', async () => {
    if (mapInstance) {
      renderMapMarkers();
      return;
    }

    const filteredPeople = getFilteredPersonas();
    const hasAnyCoord = filteredPeople.some(hasCoords) || getFilteredLocalidades().some(hasCoords);
    if (!hasAnyCoord) {
      mapStatus.textContent =
        'Ninguna persona ni localidad tiene coordenadas configuradas todavía. Agrega columnas Latitud y Longitud o un Link Google Maps por persona en tus archivos de datos/.';
      mapStatus.classList.remove('hidden');
      return;
    }

    btnEnableMap.disabled = true;
    btnEnableMap.textContent = 'Cargando mapa gratuito…';
    mapStatus.classList.add('hidden');

    try {
      const L = await loadLeafletAssets();
      mapHost.classList.remove('hidden');
      clearNode(mapHost);

      const firstPerson = filteredPeople.find(hasCoords);
      const firstLoc = getFilteredLocalidades().find(hasCoords);
      const initialCenter = firstPerson
        ? [Number(firstPerson.latitud), Number(firstPerson.longitud)]
        : firstLoc
          ? [Number(firstLoc.latitud), Number(firstLoc.longitud)]
          : [-40.5739, -73.1335];

      mapInstance = L.map(mapHost).setView(initialCenter, 12);

      const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      });
      const satLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri / Earthstar Geographics',
          maxZoom: 19,
        }
      );

      osmLayer.addTo(mapInstance);
      L.control
        .layers(
          {
            'Mapa de calles (OSM)': osmLayer,
            'Vista satélite': satLayer,
          },
          null,
          { position: 'topright' }
        )
        .addTo(mapInstance);

      markersLayer = L.layerGroup().addTo(mapInstance);
      renderMapMarkers();
      setTimeout(() => mapInstance?.invalidateSize(), 60);

      btnEnableMap.disabled = false;
      btnEnableMap.textContent = 'Centrar marcadores';
    } catch (err) {
      btnEnableMap.disabled = false;
      btnEnableMap.textContent = 'Reintentar mapa gratuito';
      mapStatus.textContent = err.message;
      mapStatus.classList.remove('hidden');
      showToast('Mapa no disponible; usa el listado con enlaces directos a Google Maps.', 'info');
    }
  });

  selLoc.addEventListener('change', () => {
    selectedLocId = selLoc.value;
    refreshAllSections();
  });
  selEstado.addEventListener('change', () => {
    selectedEstado = selEstado.value;
    refreshAllSections();
  });
  inSearch.addEventListener('input', () => {
    searchQuery = inSearch.value.trim();
    refreshAllSections();
  });

  refreshAllSections();

  const interactiveMapCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: 'Mapa interactivo gratuito y marcadores' }),
        mapSubtitle
      ),
      btnEnableMap
    ),
    el('div', { className: 'card-body' }, mapStatus, mapHost, legend, mapHintEl)
  );

  const ubicacionesCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: 'Ubicaciones y acceso directo a Google Maps' }),
        el('p', {
          className: 'card-subtitle',
          text: 'Cada persona con coordenadas, dirección o enlace guardado permite abrir su ubicación directo en Google Maps.',
        })
      )
    ),
    locationsListBody
  );

  const territoryCardSection = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el('h2', { className: 'card-title', text: 'Localidades y sectores territoriales' })
    ),
    el('div', { className: 'card-body' }, cardsGrid)
  );

  container.appendChild(toolbar);
  container.appendChild(interactiveMapCard);
  container.appendChild(ubicacionesCard);
  container.appendChild(territoryCardSection);
}
