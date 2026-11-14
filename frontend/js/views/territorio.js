/**
 * Vista de Localidades y Sectores (Grupo Señas Osorno).
 */

import { apiFetch } from '../api.js';
import {
  closeModal,
  openModal,
  openPersonDetailModal,
  renderEmptyState,
  renderLoading,
  showToast,
} from '../components.js';
import { state } from '../state.js';
import {
  clearNode,
  createBadge,
  el,
  fullName,
  getCategoryLabel,
  getStatusBadgeClass,
} from '../utils.js';

export async function renderTerritorioView(container, { navigateTo }) {
  clearNode(container);

  const contentBox = el('div', {});
  container.appendChild(contentBox);

  async function showLocalidadDetail(locId) {
    openModal({ title: 'Registros asociados a la localidad', body: renderLoading('Cargando detalle…') });
    try {
      const data = await apiFetch(`/api/localidades/${locId}`);
      const loc = data.localidad;
      const sectoresUnicos = [
        ...new Set(data.personas.map((p) => String(p.sector || '').trim()).filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b, 'es'));

      const body = el(
        'div',
        {},
        el(
          'div',
          { className: 'form-section' },
          el('h3', { className: 'form-section-title', text: `${loc.nombre}${loc.region ? ` — ${loc.region}` : ''}` }),
          loc.descripcion ? el('p', { style: { marginBottom: '10px', fontSize: '0.9rem' }, text: loc.descripcion }) : null,
          el(
            'div',
            { className: 'detail-grid' },
            el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Personas asociadas' }), el('span', { className: 'detail-val', text: String(data.personas.length) })),
            el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Sectores con registros' }), el('span', { className: 'detail-val', text: String(sectoresUnicos.length) }))
          )
        ),
        el(
          'div',
          { className: 'form-section' },
          el('h3', { className: 'form-section-title', text: 'Sectores registrados' }),
          sectoresUnicos.length
            ? el(
                'div',
                { className: 'chip-group' },
                sectoresUnicos.map((sector) => createBadge(sector, 'badge-neutral'))
              )
            : el('p', { className: 'field-hint', text: 'Sin sectores especificados aún en las fichas.' })
        ),
        el(
          'div',
          { className: 'form-section' },
          el('h3', { className: 'form-section-title', text: `Personas en ${loc.nombre} (${data.personas.length})` }),
          data.personas.length
            ? el(
                'ul',
                { className: 'activity-list' },
                data.personas.map((p) =>
                  el(
                    'li',
                    { className: 'activity-item' },
                    el(
                      'div',
                      {},
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'activity-title',
                          style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' },
                          onClick: () => openPersonDetailModal(p.id, () => loadLocalidades()),
                        },
                        `${fullName(p)} (${p.codigo_interno})`
                      ),
                      el('div', { className: 'activity-meta', text: p.sector || 'Sin sector especificado' })
                    ),
                    createBadge(getCategoryLabel(state.categorias, 'estado_registro', p.estado, p.estado), getStatusBadgeClass(p.estado))
                  )
                )
              )
            : el('p', { className: 'field-hint', text: 'No hay personas registradas en esta localidad.' })
        )
      );

      openModal({
        title: `Localidad — ${loc.nombre}`,
        body,
        footer: [
          el('button', {
            type: 'button',
            className: 'btn btn-outline',
            text: 'Ver en Personas',
            onClick: () => {
              closeModal();
              state.personasFilterPreset = { localidad_id: String(loc.id) };
              navigateTo('personas');
            },
          }),
        ],
      });
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function loadLocalidades() {
    clearNode(contentBox);
    contentBox.appendChild(renderLoading('Cargando localidades…'));

    try {
      const data = await apiFetch('/api/localidades?incluir_inactivas=1');
      const items = data.items || [];
      clearNode(contentBox);

      const card = el(
        'section',
        { className: 'card' },
        el(
          'div',
          { className: 'card-header' },
          el(
            'div',
            {},
            el('h2', { className: 'card-title', text: `Localidades y sectores (${items.length})` }),
            el('p', {
              className: 'card-subtitle',
              text: 'Consulta las localidades configuradas, sus sectores y registros asociados',
            })
          )
        ),
        items.length
          ? el(
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
                    el('th', { scope: 'col', text: 'Localidad' }),
                    el('th', { scope: 'col', text: 'Sectores' }),
                    el('th', { scope: 'col', text: 'Región / Descripción' }),
                    el('th', { scope: 'col', text: 'Personas' }),
                    el('th', { scope: 'col', text: 'Estado' }),
                    el('th', { scope: 'col', text: 'Acciones' })
                  )
                ),
                el(
                  'tbody',
                  {},
                  items.map((l) =>
                    el(
                      'tr',
                      {},
                      el('td', {}, el('strong', { text: l.nombre })),
                      el(
                        'td',
                        {},
                        l.sectores?.length
                          ? el(
                              'div',
                              { className: 'chip-group' },
                              l.sectores.map((s) => createBadge(`${s.nombre} (${s.total})`, 'badge-neutral'))
                            )
                          : el('span', { className: 'field-hint', text: 'Sin sectores' })
                      ),
                      el(
                        'td',
                        {},
                        el('div', { text: l.region || '—' }),
                        l.descripcion ? el('div', { className: 'activity-meta', text: l.descripcion }) : null
                      ),
                      el('td', { text: String(l.personas_count || 0) }),
                      el('td', {}, createBadge(l.activa ? 'Activa' : 'Inactiva', l.activa ? 'badge-success' : 'badge-neutral')),
                      el(
                        'td',
                        {},
                        el(
                          'div',
                          { className: 'row-actions' },
                          el('button', { type: 'button', className: 'btn btn-outline btn-xs', text: 'Consultar', onClick: () => showLocalidadDetail(l.id) })
                        )
                      )
                    )
                  )
                )
              )
            )
          : renderEmptyState(
              'No hay localidades creadas',
              'Aún no hay localidades registradas en la base JSON.'
            )
      );

      contentBox.appendChild(card);
    } catch (err) {
      clearNode(contentBox);
      contentBox.appendChild(el('div', { className: 'alert alert-error', text: err.message }));
    }
  }

  await loadLocalidades();
}
