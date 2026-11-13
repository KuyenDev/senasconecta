/**
 * Vista del módulo de Estadísticas territoriales y de comunicación (SeñasConecta).
 */

import { apiFetch } from '../api.js';
import { renderCommunicationMetricCard, renderHorizontalBarChart } from '../charts.js';
import { renderEmptyState, renderLoading } from '../components.js';
import { state } from '../state.js';
import { clearNode, el, getCategoryLabel } from '../utils.js';

export async function renderEstadisticasView(container, { navigateTo }) {
  clearNode(container);
  container.appendChild(renderLoading('Calculando estadísticas…'));

  let stats;
  try {
    stats = await apiFetch('/api/estadisticas');
  } catch (err) {
    clearNode(container);
    container.appendChild(el('div', { className: 'alert alert-error', text: err.message }));
    return;
  }

  clearNode(container);

  const total = Number(stats.total_personas || 0);
  const est = stats.estados_registro || {};
  const pendientesTotales =
    Number(est.pendientes_actualizacion || 0) +
    Number(est.por_confirmar || 0) +
    Number(est.requieren_visita || 0);

  if (total === 0) {
    container.appendChild(
      el(
        'section',
        { className: 'card' },
        renderEmptyState(
          'Aún no hay suficientes registros para generar estadísticas',
          'Cuando integres personas desde tus archivos en datos/, aquí verás el desglose por localidad, estado y necesidades de comunicación sin porcentajes engañosos.',
          el('button', {
            type: 'button',
            className: 'btn btn-outline',
            text: 'Ver localidades y sectores',
            onClick: () => navigateTo('territorio'),
          })
        )
      )
    );
    return;
  }

  container.appendChild(
    el(
      'section',
      { className: 'stats-grid', ariaLabel: 'Resumen estadístico' },
      el(
        'article',
        { className: 'stat-card accent-forest' },
        el('div', { className: 'stat-label', text: 'Total de personas' }),
        el('div', { className: 'stat-value', text: String(total) }),
        el('div', { className: 'stat-detail', text: 'Base total de registros actuales' })
      ),
      el(
        'article',
        { className: 'stat-card accent-olive' },
        el('div', { className: 'stat-label', text: 'Registros confirmados' }),
        el('div', { className: 'stat-value', text: String(est.confirmados || 0) }),
        el('div', { className: 'stat-detail', text: `${Math.round(((est.confirmados || 0) / total) * 1000) / 10}% del total` })
      ),
      el(
        'article',
        { className: 'stat-card accent-warn' },
        el('div', { className: 'stat-label', text: 'Registros pendientes' }),
        el('div', { className: 'stat-value', text: String(pendientesTotales) }),
        el('div', {
          className: 'stat-detail',
          text: `${est.pendientes_actualizacion || 0} por actualizar · ${est.por_confirmar || 0} por confirmar · ${est.requieren_visita || 0} visita`,
        })
      ),
      el(
        'article',
        { className: 'stat-card accent-gold' },
        el('div', { className: 'stat-label', text: 'Necesitan interpretación' }),
        el('div', { className: 'stat-value', text: String(stats.comunicacion?.necesita_interpretacion?.si || 0) }),
        el('div', {
          className: 'stat-detail',
          text: `${stats.comunicacion?.necesita_interpretacion?.sin_dato || 0} registros sin dato informado`,
        })
      )
    )
  );

  // Bloque de comunicación (con protección explícita contra datos incompletos)
  const comm = stats.comunicacion || {};
  container.appendChild(
    el(
      'section',
      { className: 'card' },
      el(
        'div',
        { className: 'card-header' },
        el(
          'div',
          {},
          el('h2', { className: 'card-title', text: 'Preferencias de comunicación y necesidades de interpretación' }),
          el('p', {
            className: 'card-subtitle',
            text: 'Los porcentajes se muestran exclusivamente sobre los registros con dato informado para evitar interpretaciones erróneas.',
          })
        )
      ),
      el(
        'div',
        { className: 'card-body' },
        el(
          'div',
          { className: 'grid-3', style: { marginBottom: '20px' } },
          renderCommunicationMetricCard('Uso de Lengua de Señas Chilena (LSCh)', comm.usa_lsch),
          renderCommunicationMetricCard('Preferencia de comunicación escrita', comm.prefiere_escrita),
          renderCommunicationMetricCard('Necesidad de interpretación', comm.necesita_interpretacion)
        ),
        el(
          'div',
          { className: 'grid-2' },
          el(
            'div',
            {},
            el('h3', { className: 'card-title', style: { marginBottom: '10px' }, text: 'Medio de comunicación preferido' }),
            renderHorizontalBarChart(
              (comm.medios || []).map((m) => ({
                label:
                  m.clave === 'sin_especificar'
                    ? 'Sin especificar'
                    : getCategoryLabel(state.categorias, 'medio_comunicacion', m.clave, m.clave),
                total: m.total,
              })),
              { goldHighlight: true }
            )
          ),
          el(
            'div',
            {},
            el('h3', { className: 'card-title', style: { marginBottom: '10px' }, text: 'Nivel de LSCh (cuando corresponde)' }),
            renderHorizontalBarChart(
              (comm.niveles_lsch || []).map((n) => ({
                label:
                  n.clave === 'sin_especificar'
                    ? 'Sin especificar'
                    : getCategoryLabel(state.categorias, 'nivel_lsch', n.clave, n.clave),
                total: n.total,
              }))
            )
          )
        )
      )
    )
  );

  // Tabla detallada por localidad
  const locRows = (stats.por_localidad || []).filter((l) => Number(l.total) > 0);

  const locDetailCard = el(
    'section',
    { className: 'card' },
    el('div', { className: 'card-header' }, el('h2', { className: 'card-title', text: 'Detalle por localidad' })),
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
            el('th', { scope: 'col', text: 'Localidad' }),
            el('th', { scope: 'col', text: 'Total' }),
            el('th', { scope: 'col', text: 'Confirmados' }),
            el('th', { scope: 'col', text: 'Pendientes' }),
            el('th', { scope: 'col', text: 'Req. interp.' })
          )
        ),
        el(
          'tbody',
          {},
          locRows.length
            ? locRows.map((l) =>
                el(
                  'tr',
                  {},
                  el('td', { text: l.nombre }),
                  el('td', {}, el('strong', { text: String(l.total) })),
                  el('td', { text: String(l.confirmados || 0) }),
                  el('td', { text: String(l.pendientes || 0) }),
                  el('td', { text: String(l.necesitan_interpretacion || 0) })
                )
              )
            : el('tr', {}, el('td', { colSpan: 5, className: 'field-hint', text: 'Aún no hay localidades con personas asociadas.' }))
        )
      )
    )
  );

  container.appendChild(locDetailCard);
}

