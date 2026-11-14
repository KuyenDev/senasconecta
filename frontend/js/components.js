/**
 * Componentes accesibles reutilizables: modales, notificaciones, estados y fichas de consulta.
 */

import { apiFetch } from './api.js';
import { state } from './state.js';
import {
  buildGoogleMapsUrl,
  clearNode,
  createBadge,
  el,
  formatDate,
  formatDateTime,
  fullName,
  getCategoryLabel,
  getStatusBadgeClass,
  hasCoords,
  triBoolLabel,
} from './utils.js';

let activeModalCleanup = null;

export function showToast(message, type = 'info') {
  const region = document.getElementById('toast-region');
  if (!region) return;

  const toast = el(
    'div',
    {
      className: `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`,
      role: 'status',
    },
    el('span', { text: message }),
    el(
      'button',
      {
        type: 'button',
        className: 'btn btn-xs',
        style: { background: 'rgba(255,255,255,0.16)', color: '#fff', minHeight: '26px' },
        ariaLabel: 'Cerrar notificación',
        onClick: () => toast.remove(),
      },
      '✕'
    )
  );

  region.appendChild(toast);
  setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, 5200);
}

export function renderLoading(message = 'Cargando información…') {
  return el(
    'div',
    { className: 'loading-box', role: 'status', ariaLive: 'polite' },
    el('div', { className: 'spinner', ariaHidden: 'true' }),
    el('span', { text: message })
  );
}

export function renderEmptyState(title, description, actionButton = null) {
  return el(
    'div',
    { className: 'empty-state' },
    el('p', { className: 'empty-state-title', text: title }),
    el('p', { className: 'empty-state-desc', text: description }),
    actionButton
  );
}

export function closeModal() {
  if (activeModalCleanup) {
    activeModalCleanup();
    activeModalCleanup = null;
  }
}

export function openModal({ title, body, footer = null, size = 'md' }) {
  closeModal();

  const root = document.getElementById('modal-root');
  if (!root) return;

  const previousFocus = document.activeElement;
  clearNode(root);
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');

  const closeBtn = el(
    'button',
    {
      type: 'button',
      className: 'icon-btn',
      ariaLabel: 'Cerrar ventana',
      onClick: () => closeModal(),
    },
    '✕'
  );

  const dialog = el(
    'div',
    {
      className: `modal-dialog ${size === 'sm' ? 'modal-sm' : ''}`,
      role: 'dialog',
      ariaModal: 'true',
      ariaLabelledby: 'modal-title-heading',
    },
    el(
      'div',
      { className: 'modal-header' },
      el('h2', { id: 'modal-title-heading', className: 'modal-title', text: title }),
      closeBtn
    ),
    el('div', { className: 'modal-body' }, body),
    footer ? el('div', { className: 'modal-footer' }, footer) : null
  );

  const onBackdropClick = (e) => {
    if (e.target === root) closeModal();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = dialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  root.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeyDown);
  root.appendChild(dialog);

  const firstInput = dialog.querySelector('input, select, textarea, button.btn-primary');
  if (firstInput) {
    firstInput.focus();
  } else {
    closeBtn.focus();
  }

  activeModalCleanup = () => {
    root.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onKeyDown);
    clearNode(root);
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
  };
}

export async function openPersonDetailModal(personId) {
  openModal({
    title: 'Ficha de persona',
    body: renderLoading('Cargando ficha completa…'),
  });

  try {
    const { persona } = await apiFetch(`/api/personas/${personId}`);
    const mapsUrl = buildGoogleMapsUrl(persona);
    const coordsText = hasCoords(persona) ? `${persona.latitud}, ${persona.longitud}` : '—';

    const body = el(
      'div',
      {},
      el(
        'div',
        { className: 'form-section' },
        el(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' } },
          el('div', {}, el('span', { className: 'code-pill', text: persona.codigo_interno }), ' ', el('strong', { style: { fontSize: '1.15rem', marginLeft: '6px' }, text: fullName(persona) })),
          el(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            mapsUrl
              ? el('a', {
                  href: mapsUrl,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  className: 'btn btn-secondary btn-xs',
                  text: 'Abrir en Google Maps',
                })
              : null,
            createBadge(
              getCategoryLabel(state.categorias, 'estado_registro', persona.estado, persona.estado),
              getStatusBadgeClass(persona.estado)
            )
          )
        ),
        el(
          'div',
          { className: 'detail-grid' },
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Localidad' }), el('span', { className: 'detail-val', text: persona.localidad_nombre || 'Sin asignar' })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Sector o barrio' }), el('span', { className: 'detail-val', text: persona.sector || '—' })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Dirección' }), el('span', { className: 'detail-val', text: persona.direccion || '—' })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Coordenadas' }), el('span', { className: 'detail-val', text: coordsText })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Fecha incorporación' }), el('span', { className: 'detail-val', text: formatDate(persona.fecha_incorporacion) }))
        )
      ),
      el(
        'div',
        { className: 'form-section' },
        el('h3', { className: 'form-section-title', text: 'Preferencias de comunicación' }),
        el(
          'div',
          { className: 'detail-grid' },
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Medio preferido' }), el('span', { className: 'detail-val', text: getCategoryLabel(state.categorias, 'medio_comunicacion', persona.medio_comunicacion) })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Utiliza LSCh' }), el('span', { className: 'detail-val', text: triBoolLabel(persona.usa_lsch) })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Nivel de LSCh' }), el('span', { className: 'detail-val', text: getCategoryLabel(state.categorias, 'nivel_lsch', persona.nivel_lsch) })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Prefiere escrita' }), el('span', { className: 'detail-val', text: triBoolLabel(persona.prefiere_escrita) })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Necesita interpretación' }), el('span', { className: 'detail-val', text: triBoolLabel(persona.necesita_interpretacion) }))
        ),
        persona.observaciones_comunicacion
          ? el('p', { style: { marginTop: '10px', fontSize: '0.9rem' }, text: `Notas de comunicación: ${persona.observaciones_comunicacion}` })
          : null
      ),
      el(
        'div',
        { className: 'form-section' },
        el('h3', { className: 'form-section-title', text: 'Notas, fechas y origen del dato' }),
        el(
          'div',
          { className: 'detail-grid' },
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Última visita' }), el('span', { className: 'detail-val', text: formatDate(persona.fecha_ultima_visita) })),
          persona.proxima_accion
            ? el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Nota / Próxima acción' }), el('span', { className: 'detail-val', text: persona.proxima_accion }))
            : null,
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Fecha del dato' }), el('span', { className: 'detail-val', text: persona.fecha_dato ? formatDate(persona.fecha_dato) : '—' })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Archivo fuente' }), el('span', { className: 'detail-val', text: persona.archivo_fuente || '—' })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Última actualización' }), el('span', { className: 'detail-val', text: formatDateTime(persona.fecha_actualizacion) })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Consentimiento' }), el('span', { className: 'detail-val', text: persona.consentimiento_registrado ? `Registrado (${formatDate(persona.fecha_consentimiento)})` : 'Pendiente' }))
        ),
        persona.observaciones
          ? el('p', { style: { marginTop: '10px', fontSize: '0.9rem' }, text: `Observaciones: ${persona.observaciones}` })
          : null
      )
    );

    const footer = [
      el('button', {
        type: 'button',
        className: 'btn btn-primary',
        text: 'Cerrar',
        onClick: () => closeModal(),
      }),
    ];

    openModal({
      title: `Ficha — ${fullName(persona)}`,
      body,
      footer,
    });
  } catch (err) {
    closeModal();
    showToast(err.message || 'No se pudo cargar la ficha.', 'error');
  }
}
