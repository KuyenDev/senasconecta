/**
 * Vista del módulo de Registro de Personas (búsqueda, filtros combinables, orden y fichas).
 */

import { apiFetch } from '../api.js';
import {
  downloadExportFile,
  openPersonDetailModal,
  renderEmptyState,
  renderLoading,
} from '../components.js';
import { state } from '../state.js';
import {
  buildGoogleMapsUrl,
  clearNode,
  createBadge,
  el,
  formatDate,
  fullName,
  getCategoryLabel,
  getStatusBadgeClass,
  triBoolLabel,
} from '../utils.js';

export async function renderPersonasView(container) {
  const filters = {
    q: state.personasFilterPreset?.q || '',
    localidad_id: state.personasFilterPreset?.localidad_id || '',
    estado: state.personasFilterPreset?.estado || '',
    usa_lsch: state.personasFilterPreset?.usa_lsch || '',
    sort: 'fecha_actualizacion',
    order: 'desc',
    page: 1,
  };
  state.personasFilterPreset = null;

  clearNode(container);

  const inputSearch = el('input', {
    id: 'filter-q',
    type: 'search',
    className: 'input',
    value: filters.q,
    placeholder: 'Buscar por nombre, dirección, sector, notas o código…',
  });

  const selLoc = el(
    'select',
    { id: 'filter-loc', className: 'select' },
    el('option', { value: '', text: 'Todas las localidades' }),
    el('option', { value: 'none', text: 'Sin localidad asignada' }),
    state.localidades.map((l) => el('option', { value: String(l.id), text: l.nombre }))
  );
  selLoc.value = filters.localidad_id;

  const selEstado = el(
    'select',
    { id: 'filter-estado', className: 'select' },
    el('option', { value: '', text: 'Todos los estados' }),
    (state.categorias.estado_registro || []).map((c) =>
      el('option', { value: c.clave, text: c.etiqueta })
    )
  );
  selEstado.value = filters.estado;

  const selLsch = el(
    'select',
    { id: 'filter-lsch', className: 'select' },
    el('option', { value: '', text: 'LSCh: todos' }),
    el('option', { value: '1', text: 'Utiliza LSCh: Sí' }),
    el('option', { value: '0', text: 'Utiliza LSCh: No' }),
    el('option', { value: 'null', text: 'LSCh: Por confirmar' })
  );
  selLsch.value = filters.usa_lsch;

  const selSort = el(
    'select',
    { id: 'filter-sort', className: 'select' },
    el('option', { value: 'fecha_actualizacion', text: 'Orden: Actualización' }),
    el('option', { value: 'fecha_dato', text: 'Orden: Fecha del dato' }),
    el('option', { value: 'nombre', text: 'Orden: Nombre' }),
    el('option', { value: 'localidad', text: 'Orden: Localidad' }),
    el('option', { value: 'estado', text: 'Orden: Estado' }),
    el('option', { value: 'fecha_ultima_visita', text: 'Orden: Última visita' })
  );
  selSort.value = filters.sort;

  const selOrder = el(
    'select',
    { id: 'filter-order', className: 'select' },
    el('option', { value: 'desc', text: 'Descendente' }),
    el('option', { value: 'asc', text: 'Ascendente' })
  );
  selOrder.value = filters.order;

  const toolbar = el(
    'section',
    { className: 'toolbar', ariaLabel: 'Filtros de búsqueda de personas' },
    el('div', { className: 'field field-grow' }, el('label', { className: 'field-label', for: 'filter-q', text: 'Buscar' }), inputSearch),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'filter-loc', text: 'Localidad' }), selLoc),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'filter-estado', text: 'Estado' }), selEstado),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'filter-lsch', text: 'LSCh' }), selLsch),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'filter-sort', text: 'Ordenar por' }), selSort),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'filter-order', text: 'Dirección' }), selOrder),
    el(
      'div',
      { className: 'field' },
      el('button', {
        type: 'button',
        className: 'btn btn-outline',
        text: 'Limpiar',
        onClick: () => {
          inputSearch.value = '';
          selLoc.value = '';
          selEstado.value = '';
          selLsch.value = '';
          selSort.value = 'fecha_actualizacion';
          selOrder.value = 'desc';
          Object.assign(filters, {
            q: '',
            localidad_id: '',
            estado: '',
            usa_lsch: '',
            sort: 'fecha_actualizacion',
            order: 'desc',
            page: 1,
          });
          loadTable();
        },
      })
    )
  );

  const listCard = el('section', { className: 'card' });
  container.appendChild(toolbar);
  container.appendChild(listCard);

  let searchTimer = null;

  async function loadTable() {
    clearNode(listCard);
    listCard.appendChild(renderLoading('Consultando registros…'));

    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.localidad_id) params.set('localidad_id', filters.localidad_id);
    if (filters.estado) params.set('estado', filters.estado);
    if (filters.usa_lsch) params.set('usa_lsch', filters.usa_lsch);
    params.set('sort', filters.sort);
    params.set('order', filters.order);
    params.set('page', String(filters.page));
    params.set('limit', '50');

    try {
      const data = await apiFetch(`/api/personas?${params.toString()}`);
      renderTableData(data);
    } catch (err) {
      clearNode(listCard);
      listCard.appendChild(
        el('div', { className: 'card-body' }, el('div', { className: 'alert alert-error', text: err.message }))
      );
    }
  }

  function renderTableData(data) {
    clearNode(listCard);
    const items = data.items || [];
    const total = Number(data.total || 0);

    const header = el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: `Personas registradas (${total})` }),
        el('p', { className: 'card-subtitle', text: 'Haz clic en cualquier nombre para consultar su ficha completa, notas y mapa' })
      ),
      el('button', {
        type: 'button',
        className: 'btn btn-secondary btn-sm',
        text: 'Descargar Excel simple',
        disabled: total === 0,
        onClick: () => downloadExportFile('xlsx_simple', filters),
      })
    );
    listCard.appendChild(header);

    if (!items.length) {
      const hasFilters = Boolean(
        filters.q || filters.localidad_id || filters.estado || filters.usa_lsch
      );
      listCard.appendChild(
        renderEmptyState(
          hasFilters ? 'Sin coincidencias para los filtros aplicados' : 'No hay personas registradas todavía',
          hasFilters
            ? 'Prueba limpiando o combinando otros criterios de búsqueda.'
            : 'Todavía no existen registros publicados. Agrega tus archivos en datos/ y ejecuta python3 scripts/importar_excel.py.'
        )
      );
      return;
    }

    const tbody = el(
      'tbody',
      {},
      items.map((p) => {
        const commParts = [];
        if (p.medio_comunicacion) {
          commParts.push(getCategoryLabel(state.categorias, 'medio_comunicacion', p.medio_comunicacion));
        }
        if (p.usa_lsch !== null && p.usa_lsch !== undefined) {
          commParts.push(`LSCh: ${triBoolLabel(p.usa_lsch)}`);
        }
        if (p.necesita_interpretacion === 1) {
          commParts.push('Req. interpretación');
        }
        const mapsUrl = buildGoogleMapsUrl(p);
        const locationDetail = [p.sector, p.direccion].filter(Boolean).join(' · ');

        return el(
          'tr',
          {},
          el('td', {}, el('span', { className: 'code-pill', text: p.codigo_interno })),
          el(
            'td',
            {},
            el(
              'button',
              {
                type: 'button',
                className: 'activity-title',
                style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline' },
                onClick: () => openPersonDetailModal(p.id, () => loadTable()),
              },
              fullName(p)
            ),
            p.observaciones
              ? el('div', { className: 'activity-meta', text: p.observaciones })
              : null,
            p.proxima_accion
              ? el('div', { className: 'activity-meta', text: p.proxima_accion })
              : null
          ),
          el(
            'td',
            {},
            el('div', { text: p.localidad_nombre || 'Sin localidad' }),
            locationDetail ? el('div', { className: 'activity-meta', text: locationDetail }) : null
          ),
          el(
            'td',
            {},
            commParts.length
              ? el('div', { className: 'activity-meta', style: { color: 'var(--text-primary)' }, text: commParts.join(' · ') })
              : el('span', { className: 'field-hint', text: 'Por confirmar' })
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
            el('div', { text: p.fecha_ultima_visita ? formatDate(p.fecha_ultima_visita) : '—' }),
            el('div', {
              className: 'activity-meta',
              text: p.fecha_dato ? `Dato ${formatDate(p.fecha_dato)}` : `Act. ${formatDate(p.fecha_actualizacion)}`,
            })
          ),
          el(
            'td',
            {},
            el(
              'div',
              { className: 'row-actions' },
              el('button', {
                type: 'button',
                className: 'btn btn-outline btn-xs',
                text: 'Ver ficha',
                onClick: () => openPersonDetailModal(p.id),
              }),
              mapsUrl
                ? el('a', {
                    href: mapsUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'btn btn-secondary btn-xs',
                    text: 'Maps',
                  })
                : null
            )
          )
        );
      })
    );

    const table = el(
      'table',
      { className: 'data-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col', text: 'Código' }),
          el('th', { scope: 'col', text: 'Nombre / Notas' }),
          el('th', { scope: 'col', text: 'Localidad / Dirección' }),
          el('th', { scope: 'col', text: 'Comunicación' }),
          el('th', { scope: 'col', text: 'Estado' }),
          el('th', { scope: 'col', text: 'Visita / Dato' }),
          el('th', { scope: 'col', text: 'Acciones' })
        )
      ),
      tbody
    );

    listCard.appendChild(el('div', { className: 'table-wrap' }, table));

    const totalPages = Math.ceil(total / 50);
    if (totalPages > 1) {
      listCard.appendChild(
        el(
          'div',
          { className: 'card-header', style: { borderTop: '1px solid var(--border-subtle)', borderBottom: 0 } },
          el('span', { className: 'field-hint', text: `Página ${filters.page} de ${totalPages}` }),
          el(
            'div',
            { className: 'row-actions' },
            el('button', {
              type: 'button',
              className: 'btn btn-outline btn-xs',
              disabled: filters.page <= 1,
              text: 'Anterior',
              onClick: () => {
                filters.page -= 1;
                loadTable();
              },
            }),
            el('button', {
              type: 'button',
              className: 'btn btn-outline btn-xs',
              disabled: filters.page >= totalPages,
              text: 'Siguiente',
              onClick: () => {
                filters.page += 1;
                loadTable();
              },
            })
          )
        )
      );
    }
  }

  inputSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = inputSearch.value.trim();
      filters.page = 1;
      loadTable();
    }, 240);
  });

  for (const [selectEl, key] of [
    [selLoc, 'localidad_id'],
    [selEstado, 'estado'],
    [selLsch, 'usa_lsch'],
    [selSort, 'sort'],
    [selOrder, 'order'],
  ]) {
    selectEl.addEventListener('change', () => {
      filters[key] = selectEl.value;
      filters.page = 1;
      loadTable();
    });
  }

  await loadTable();
}

