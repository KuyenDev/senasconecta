/**
 * Vista de Panel Principal (Dashboard) de SeñasConecta.
 */

import { apiFetch } from '../api.js';
import { renderHorizontalBarChart } from '../charts.js';
import {
  openPersonDetailModal,
  openPersonFormModal,
  openSeguimientoFormModal,
  renderEmptyState,
  renderLoading,
} from '../components.js';
import { state } from '../state.js';
import {
  clearNode,
  createBadge,
  el,
  formatDate,
  formatDateTime,
  fullName,
  getCategoryLabel,
  getStatusBadgeClass,
} from '../utils.js';

export async function renderDashboardView(container, { navigateTo }) {
  clearNode(container);
  container.appendChild(renderLoading('Cargando resumen territorial…'));

  let data;
  try {
    data = await apiFetch('/api/dashboard');
  } catch (err) {
    clearNode(container);
    container.appendChild(
      el('div', { className: 'alert alert-error', role: 'alert', text: err.message })
    );
    return;
  }

  clearNode(container);
  const r = data.resumen || {};

  const pendientesTotal =
    Number(r.pendientes_actualizacion || 0) +
    Number(r.por_confirmar || 0) +
    Number(r.requieren_visita || 0);

  const statsGrid = el(
    'section',
    { className: 'stats-grid', ariaLabel: 'Indicadores principales' },
    el(
      'article',
      { className: 'stat-card accent-forest' },
      el('div', { className: 'stat-label', text: 'Personas registradas' }),
      el('div', { className: 'stat-value', text: String(r.total_personas || 0) }),
      el('div', { className: 'stat-detail', text: `${r.necesitan_interpretacion || 0} requieren interpretación` })
    ),
    el(
      'article',
      { className: 'stat-card accent-olive' },
      el('div', { className: 'stat-label', text: 'Localidades' }),
      el('div', { className: 'stat-value', text: String(r.total_localidades || 0) }),
      el('div', { className: 'stat-detail', text: `${r.localidades_activas || 0} activas en territorio` })
    ),
    el(
      'article',
      { className: 'stat-card accent-olive' },
      el('div', { className: 'stat-label', text: 'Utilizan LSCh' }),
      el('div', { className: 'stat-value', text: String(r.usan_lsch || 0) }),
      el('div', {
        className: 'stat-detail',
        text: `${r.prefieren_escrita || 0} prefieren comunicación escrita`,
      })
    ),
    el(
      'article',
      { className: 'stat-card accent-forest' },
      el('div', { className: 'stat-label', text: 'Registros confirmados' }),
      el('div', { className: 'stat-value', text: String(r.confirmados || 0) }),
      el('div', { className: 'stat-detail', text: 'Información verificada al día' })
    ),
    el(
      'article',
      { className: 'stat-card accent-warn' },
      el('div', { className: 'stat-label', text: 'Pendientes de actualización' }),
      el('div', { className: 'stat-value', text: String(pendientesTotal) }),
      el('div', {
        className: 'stat-detail',
        text: `${r.pendientes_actualizacion || 0} por actualizar · ${r.por_confirmar || 0} por confirmar`,
      })
    ),
    el(
      'article',
      { className: 'stat-card accent-gold' },
      el('div', { className: 'stat-label', text: 'Seguimientos pendientes' }),
      el('div', { className: 'stat-value', text: String(r.seguimientos_pendientes || 0) }),
      el('div', { className: 'stat-detail', text: `${r.requieren_visita || 0} fichas marcan visita pendiente` })
    )
  );

  container.appendChild(statsGrid);

  if (Number(r.total_personas || 0) === 0) {
    container.appendChild(
      el(
        'div',
        { className: 'card' },
        renderEmptyState(
          state.authenticated ? 'Comienza organizando tu territorio' : 'Territorio sin personas registradas aún',
          state.authenticated
            ? 'Aún no hay personas registradas en SeñasConecta para el Grupo Señas Osorno. Puedes agregar el primer registro o revisar las localidades configuradas.'
            : 'Aún no hay personas registradas en SeñasConecta. Puedes consultar las localidades y sectores disponibles.',
          el(
            'div',
            { style: { display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' } },
            state.authenticated
              ? el('button', {
                  type: 'button',
                  className: 'btn btn-primary',
                  text: '+ Registrar primera persona',
                  onClick: () => openPersonFormModal(null, () => renderDashboardView(container, { navigateTo })),
                })
              : null,
            el('button', {
              type: 'button',
              className: 'btn btn-outline',
              text: state.authenticated ? 'Organizar localidades y sectores' : 'Ver localidades y sectores',
              onClick: () => navigateTo('territorio'),
            })
          )
        )
      )
    );
  }

  const chartsRow = el(
    'div',
    { className: 'grid-2' },
    el(
      'section',
      { className: 'card' },
      el(
        'div',
        { className: 'card-header' },
        el(
          'div',
          {},
          el('h2', { className: 'card-title', text: 'Distribución por localidad' }),
          el('p', { className: 'card-subtitle', text: 'Haz clic en una localidad para filtrar su registro' })
        )
      ),
      el(
        'div',
        { className: 'card-body' },
        renderHorizontalBarChart(data.distribucion_localidades, {
          labelKey: 'localidad_nombre',
          valueKey: 'total',
          emptyText: 'Aún no hay personas asignadas a localidades.',
          goldHighlight: true,
          onItemClick: (item) => {
            state.personasFilterPreset = {
              localidad_id: item.localidad_id === null ? 'none' : String(item.localidad_id),
            };
            navigateTo('personas');
          },
        })
      )
    ),
    el(
      'section',
      { className: 'card' },
      el(
        'div',
        { className: 'card-header' },
        el(
          'div',
          {},
          el('h2', { className: 'card-title', text: 'Estado de los registros' }),
          el('p', { className: 'card-subtitle', text: 'Seguimiento del estado general de las fichas registradas' })
        )
      ),
      el(
        'div',
        { className: 'card-body' },
        renderHorizontalBarChart(
          (data.distribucion_estados || []).map((item) => ({
            ...item,
            estado_label: getCategoryLabel(state.categorias, 'estado_registro', item.estado, item.estado),
          })),
          {
            labelKey: 'estado_label',
            valueKey: 'total',
            emptyText: 'Aún no hay personas registradas para mostrar estados.',
            onItemClick: (item) => {
              state.personasFilterPreset = { estado: item.estado };
              navigateTo('personas');
            },
          }
        )
      )
    )
  );

  const recentAddedCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el('h2', { className: 'card-title', text: 'Últimos registros agregados' }),
      el('button', {
        type: 'button',
        className: 'btn btn-outline btn-xs',
        text: 'Ver todos',
        onClick: () => navigateTo('personas'),
      })
    ),
    el(
      'div',
      { className: 'card-body' },
      data.ultimos_agregados?.length
        ? el(
            'ul',
            { className: 'activity-list' },
            data.ultimos_agregados.map((p) =>
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
                      style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' },
                      onClick: () => openPersonDetailModal(p.id, () => renderDashboardView(container, { navigateTo })),
                    },
                    `${fullName(p)} (${p.codigo_interno})`
                  ),
                  el('div', {
                    className: 'activity-meta',
                    text: `${p.localidad_nombre || 'Sin localidad'}${p.sector ? ` · ${p.sector}` : ''} · ${formatDateTime(p.fecha_creacion)}`,
                  })
                ),
                createBadge(
                  getCategoryLabel(state.categorias, 'estado_registro', p.estado, p.estado),
                  getStatusBadgeClass(p.estado)
                )
              )
            )
          )
        : el('p', { className: 'field-hint', text: 'Todavía no se han agregado registros.' })
    )
  );

  const recentModifiedCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el('h2', { className: 'card-title', text: 'Últimas modificaciones' }),
      state.authenticated
        ? el('button', {
            type: 'button',
            className: 'btn btn-outline btn-xs',
            text: '+ Seguimiento',
            onClick: () => openSeguimientoFormModal(null, () => renderDashboardView(container, { navigateTo })),
          })
        : null
    ),
    el(
      'div',
      { className: 'card-body' },
      data.ultimas_modificaciones?.length || data.ultimos_seguimientos_modificados?.length
        ? el(
            'ul',
            { className: 'activity-list' },
            [
              ...(data.ultimas_modificaciones || []).slice(0, 4).map((p) =>
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
                        style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' },
                        onClick: () => openPersonDetailModal(p.id, () => renderDashboardView(container, { navigateTo })),
                      },
                      `Ficha: ${fullName(p)}`
                    ),
                    el('div', {
                      className: 'activity-meta',
                      text: `${p.localidad_nombre || 'Sin localidad'} · Actualizado ${formatDateTime(p.fecha_actualizacion)}`,
                    })
                  ),
                  createBadge(
                    getCategoryLabel(state.categorias, 'estado_registro', p.estado, p.estado),
                    getStatusBadgeClass(p.estado)
                  )
                )
              ),
              ...(data.ultimos_seguimientos_modificados || []).slice(0, 3).map((s) =>
                el(
                  'li',
                  { className: 'activity-item' },
                  el(
                    'div',
                    {},
                    el('div', {
                      className: 'activity-title',
                      text: `Seguimiento: ${getCategoryLabel(state.categorias, 'tipo_seguimiento', s.tipo, s.tipo)}`,
                    }),
                    el('div', {
                      className: 'activity-meta',
                      text: `${s.persona_nombre ? fullName({ nombre: s.persona_nombre, apellido: s.persona_apellido }) : s.localidad_nombre || 'General'} · ${formatDate(s.fecha)}`,
                    })
                  ),
                  createBadge(
                    getCategoryLabel(state.categorias, 'estado_seguimiento', s.estado, s.estado),
                    getStatusBadgeClass(s.estado)
                  )
                )
              ),
            ]
          )
        : el('p', { className: 'field-hint', text: 'Sin modificaciones recientes.' })
    )
  );

  container.appendChild(chartsRow);
  container.appendChild(el('div', { className: 'grid-2' }, recentAddedCard, recentModifiedCard));
}

