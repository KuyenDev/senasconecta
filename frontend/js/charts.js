/**
 * Visualizaciones estadísticas ligeras y accesibles en SVG/HTML puro para SeñasConecta.
 */

import { el } from './utils.js';

export function renderHorizontalBarChart(items, options = {}) {
  const {
    labelKey = 'label',
    valueKey = 'total',
    emptyText = 'No hay datos registrados todavía.',
    goldHighlight = false,
    onItemClick = null,
  } = options;

  const valid = (items || []).filter((item) => Number(item[valueKey] || 0) > 0);
  if (!valid.length) {
    return el('p', { className: 'field-hint', text: emptyText });
  }

  const maxValue = Math.max(...valid.map((item) => Number(item[valueKey] || 0)), 1);

  return el(
    'div',
    { className: 'chart-bar-list', role: 'list' },
    valid.map((item, idx) => {
      const value = Number(item[valueKey] || 0);
      const pct = Math.max(4, Math.round((value / maxValue) * 100));
      const label = item[labelKey] || 'Sin especificar';

      const labelNode = onItemClick
        ? el(
            'button',
            {
              type: 'button',
              className: 'chart-bar-label',
              style: {
                background: 'transparent',
                border: '0',
                padding: '0',
                textAlign: 'left',
                cursor: 'pointer',
                textDecoration: 'underline',
              },
              onClick: () => onItemClick(item),
            },
            label
          )
        : el('span', { className: 'chart-bar-label', title: label, text: label });

      return el(
        'div',
        { className: 'chart-bar-row', role: 'listitem' },
        labelNode,
        el(
          'div',
          { className: 'chart-bar-track', ariaHidden: 'true' },
          el('div', {
            className: `chart-bar-fill${goldHighlight && idx === 0 ? ' gold' : ''}`,
            style: { width: `${pct}%` },
          })
        ),
        el('span', { className: 'chart-bar-value', text: String(value) })
      );
    })
  );
}

/**
 * Tarjeta de métrica proporcional que evita porcentajes engañosos cuando hay registros sin dato.
 */
export function renderCommunicationMetricCard(title, metric) {
  const si = Number(metric?.si || 0);
  const no = Number(metric?.no || 0);
  const sinDato = Number(metric?.sin_dato || 0);
  const conDato = Number(metric?.con_dato || 0);
  const total = Number(metric?.total || 0);

  const hasEnoughData = conDato > 0;
  const pctSi = hasEnoughData ? metric.porcentaje_si_informado : null;
  const pctNo = hasEnoughData ? metric.porcentaje_no_informado : null;

  return el(
    'div',
    { className: 'territory-card' },
    el('h3', { className: 'card-title', text: title }),
    total === 0
      ? el('p', { className: 'field-hint', text: 'Aún no hay personas registradas.' })
      : [
          el(
            'div',
            { className: 'detail-grid' },
            el(
              'div',
              { className: 'detail-item' },
              el('span', { className: 'detail-label', text: 'Sí' }),
              el('span', {
                className: 'detail-val',
                text: hasEnoughData ? `${si} (${pctSi}% de informados)` : `${si}`,
              })
            ),
            el(
              'div',
              { className: 'detail-item' },
              el('span', { className: 'detail-label', text: 'No' }),
              el('span', {
                className: 'detail-val',
                text: hasEnoughData ? `${no} (${pctNo}% de informados)` : `${no}`,
              })
            ),
            el(
              'div',
              { className: 'detail-item' },
              el('span', { className: 'detail-label', text: 'Sin especificar' }),
              el('span', { className: 'detail-val', text: `${sinDato}` })
            )
          ),
          conDato === 0
            ? el('p', {
                className: 'field-hint',
                text: `No se muestran porcentajes porque los ${total} registros aún no tienen este dato informado.`,
              })
            : sinDato > 0
              ? el('p', {
                  className: 'field-hint',
                  text: `Porcentajes calculados únicamente sobre ${conDato} de ${total} registros con dato informado (${sinDato} sin dato).`,
                })
              : el('p', {
                  className: 'field-hint',
                  text: `Cobertura completa: ${conDato} de ${total} registros informados.`,
                }),
        ]
  );
}

