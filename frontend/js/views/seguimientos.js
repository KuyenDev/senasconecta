/**
 * Vista del módulo de Seguimiento Territorial de SeñasConecta.
 */

import { apiFetch } from '../api.js';
import {
  openConfirmDialog,
  openPersonDetailModal,
  openSeguimientoFormModal,
  renderEmptyState,
  renderLoading,
  showToast,
} from '../components.js';
import { state } from '../state.js';
import {
  clearNode,
  createBadge,
  el,
  formatDate,
  fullName,
  getCategoryLabel,
  getStatusBadgeClass,
} from '../utils.js';

export async function renderSeguimientosView(container) {
  const filters = {
    q: '',
    tipo: '',
    estado: '',
    localidad_id: '',
  };

  clearNode(container);

  const inSearch = el('input', {
    id: 'seg-q',
    type: 'search',
    className: 'input',
    placeholder: 'Buscar en descripción o nombre de persona…',
  });

  const selTipo = el(
    'select',
    { id: 'seg-tipo', className: 'select' },
    el('option', { value: '', text: 'Todos los tipos' }),
    (state.categorias.tipo_seguimiento || []).map((c) =>
      el('option', { value: c.clave, text: c.etiqueta })
    )
  );

  const selEstado = el(
    'select',
    { id: 'seg-estado', className: 'select' },
    el('option', { value: '', text: 'Todos los estados' }),
    (state.categorias.estado_seguimiento || []).map((c) =>
      el('option', { value: c.clave, text: c.etiqueta })
    )
  );

  const selLoc = el(
    'select',
    { id: 'seg-loc', className: 'select' },
    el('option', { value: '', text: 'Todas las localidades' }),
    state.localidades.map((l) => el('option', { value: String(l.id), text: l.nombre }))
  );

  const toolbar = el(
    'section',
    { className: 'toolbar', ariaLabel: 'Filtros de seguimientos' },
    el('div', { className: 'field field-grow' }, el('label', { className: 'field-label', for: 'seg-q', text: 'Buscar' }), inSearch),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'seg-tipo', text: 'Tipo' }), selTipo),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'seg-estado', text: 'Estado' }), selEstado),
    el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'seg-loc', text: 'Localidad' }), selLoc),
    el(
      'div',
      { className: 'field' },
      el('button', {
        type: 'button',
        className: 'btn btn-outline',
        text: 'Limpiar',
        onClick: () => {
          inSearch.value = '';
          selTipo.value = '';
          selEstado.value = '';
          selLoc.value = '';
          Object.assign(filters, { q: '', tipo: '', estado: '', localidad_id: '' });
          loadSeguimientos();
        },
      })
    )
  );

  const listCard = el('section', { className: 'card' });
  container.appendChild(toolbar);
  container.appendChild(listCard);

  let timer = null;

  async function loadSeguimientos() {
    clearNode(listCard);
    listCard.appendChild(renderLoading('Cargando seguimientos…'));

    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.tipo) params.set('tipo', filters.tipo);
    if (filters.estado) params.set('estado', filters.estado);
    if (filters.localidad_id) params.set('localidad_id', filters.localidad_id);

    try {
      const data = await apiFetch(`/api/seguimientos?${params.toString()}`);
      renderList(data.items || []);
    } catch (err) {
      clearNode(listCard);
      listCard.appendChild(
        el('div', { className: 'card-body' }, el('div', { className: 'alert alert-error', text: err.message }))
      );
    }
  }

  function renderList(items) {
    clearNode(listCard);

    listCard.appendChild(
      el(
        'div',
        { className: 'card-header' },
        el(
          'div',
          {},
          el('h2', { className: 'card-title', text: `Seguimiento territorial (${items.length})` }),
          el('p', { className: 'card-subtitle', text: 'Visitas, confirmaciones de datos, necesidades de interpretación y próximas acciones' })
        ),
        state.authenticated
          ? el('button', {
              type: 'button',
              className: 'btn btn-primary btn-sm',
              text: '+ Nuevo seguimiento',
              onClick: () => openSeguimientoFormModal(null, () => loadSeguimientos()),
            })
          : null
      )
    );

    if (!items.length) {
      listCard.appendChild(
        renderEmptyState(
          'Sin seguimientos para mostrar',
          state.authenticated
            ? 'Registra visitas realizadas, pendientes, necesidades de interpretación o acciones próximas para coordinar el apoyo.'
            : 'No hay registros de seguimiento territorial con los criterios seleccionados.',
          state.authenticated
            ? el('button', {
                type: 'button',
                className: 'btn btn-primary',
                text: '+ Registrar seguimiento',
                onClick: () => openSeguimientoFormModal(null, () => loadSeguimientos()),
              })
            : null
        )
      );
      return;
    }

    const isAdmin = Boolean(state.authenticated);
    const table = el(
      'table',
      { className: 'data-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col', text: 'Fecha' }),
          el('th', { scope: 'col', text: 'Tipo' }),
          el('th', { scope: 'col', text: 'Persona / Localidad' }),
          el('th', { scope: 'col', text: 'Descripción' }),
          el('th', { scope: 'col', text: 'Estado' }),
          isAdmin ? el('th', { scope: 'col', text: 'Acciones' }) : null
        )
      ),
      el(
        'tbody',
        {},
        items.map((s) =>
          el(
            'tr',
            {},
            el('td', { style: { whiteSpace: 'nowrap' }, text: formatDate(s.fecha) }),
            el('td', {}, createBadge(getCategoryLabel(state.categorias, 'tipo_seguimiento', s.tipo, s.tipo), 'badge-gold')),
            el(
              'td',
              {},
              s.persona_id
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: 'activity-title',
                      style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline', textAlign: 'left' },
                      onClick: () => openPersonDetailModal(s.persona_id, () => loadSeguimientos()),
                    },
                    `${fullName({ nombre: s.persona_nombre, apellido: s.persona_apellido })} (${s.persona_codigo || ''})`
                  )
                : el('span', { className: 'field-hint', text: 'Seguimiento territorial general' }),
              s.localidad_nombre ? el('div', { className: 'activity-meta', text: s.localidad_nombre }) : null
            ),
            el('td', { style: { maxWidth: '340px' }, text: s.descripcion }),
            el(
              'td',
              {},
              createBadge(
                getCategoryLabel(state.categorias, 'estado_seguimiento', s.estado, s.estado),
                getStatusBadgeClass(s.estado)
              )
            ),
            isAdmin
              ? el(
                  'td',
                  {},
                  el(
                    'div',
                    { className: 'row-actions' },
                    s.estado !== 'completado'
                      ? el('button', {
                          type: 'button',
                          className: 'btn btn-outline btn-xs',
                          text: 'Completar',
                          onClick: async () => {
                            try {
                              await apiFetch(`/api/seguimientos/${s.id}`, {
                                method: 'PUT',
                                body: { estado: 'completado' },
                              });
                              showToast('Seguimiento marcado como completado.', 'success');
                              loadSeguimientos();
                            } catch (err) {
                              showToast(err.message, 'error');
                            }
                          },
                        })
                      : null,
                    el('button', {
                      type: 'button',
                      className: 'btn btn-secondary btn-xs',
                      text: 'Editar',
                      onClick: () => openSeguimientoFormModal(s, () => loadSeguimientos()),
                    }),
                    el('button', {
                      type: 'button',
                      className: 'btn btn-ghost-danger btn-xs',
                      text: 'Eliminar',
                      onClick: () =>
                        openConfirmDialog({
                          title: 'Eliminar seguimiento',
                          message: '¿Seguro que deseas eliminar este registro de seguimiento?',
                          confirmLabel: 'Eliminar',
                          onConfirm: async () => {
                            await apiFetch(`/api/seguimientos/${s.id}`, { method: 'DELETE' });
                            showToast('Seguimiento eliminado.', 'success');
                            loadSeguimientos();
                          },
                        }),
                    })
                  )
                )
              : null
          )
        )
      )
    );

    listCard.appendChild(el('div', { className: 'table-wrap' }, table));
  }

  inSearch.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.q = inSearch.value.trim();
      loadSeguimientos();
    }, 240);
  });

  for (const [elSel, key] of [
    [selTipo, 'tipo'],
    [selEstado, 'estado'],
    [selLoc, 'localidad_id'],
  ]) {
    elSel.addEventListener('change', () => {
      filters[key] = elSel.value;
      loadSeguimientos();
    });
  }

  await loadSeguimientos();
}

