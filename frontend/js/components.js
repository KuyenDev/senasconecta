/**
 * Componentes accesibles reutilizables: modales, notificaciones, confirmaciones y formularios.
 */

import { apiFetch, refreshReferenceData } from './api.js';
import { state } from './state.js';
import {
  clearNode,
  createBadge,
  el,
  formatDate,
  formatDateTime,
  fullName,
  getCategoryLabel,
  getStatusBadgeClass,
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

function ensureAdminOrWarn() {
  if (state.authenticated) return true;
  showToast('Inicia sesión como administrador con GitHub para realizar cambios.', 'info');
  return false;
}

export function openConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  danger = true,
  onConfirm,
}) {
  if (!ensureAdminOrWarn()) return;
  const errBox = el('div', { className: 'alert alert-error hidden', role: 'alert' });
  const confirmBtn = el('button', {
    type: 'button',
    className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
    text: confirmLabel,
  });
  const cancelBtn = el('button', {
    type: 'button',
    className: 'btn btn-outline',
    text: 'Cancelar',
    onClick: () => closeModal(),
  });

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    errBox.classList.add('hidden');
    try {
      await onConfirm();
      closeModal();
    } catch (err) {
      confirmBtn.disabled = false;
      errBox.textContent = err.message || 'No se pudo completar la acción.';
      errBox.classList.remove('hidden');
    }
  });

  openModal({
    title,
    size: 'sm',
    body: el('div', {}, errBox, el('p', { text: message })),
    footer: [cancelBtn, confirmBtn],
  });
}

function createSelectOptions(items, selectedVal, emptyLabel = 'Sin especificar') {
  const opts = [];
  if (emptyLabel !== null) {
    opts.push(el('option', { value: '', text: emptyLabel }));
  }
  for (const item of items) {
    const val = String(item.value);
    const opt = el('option', { value: val, text: item.label });
    if (String(selectedVal ?? '') === val) opt.selected = true;
    opts.push(opt);
  }
  return opts;
}

function triBoolValue(val) {
  if (val === 1 || val === true) return '1';
  if (val === 0 || val === false) return '0';
  return '';
}

function parseTriSelect(val) {
  if (val === '1') return 1;
  if (val === '0') return 0;
  return null;
}

export function openPersonFormModal(existing = null, onSaved = null) {
  if (!ensureAdminOrWarn()) return;
  const isEdit = Boolean(existing && existing.id);
  const errorBanner = el('div', { className: 'alert alert-error hidden', role: 'alert' });

  const inputNombre = el('input', {
    id: 'p-nombre',
    type: 'text',
    className: 'input',
    required: true,
    maxLength: 120,
    value: existing?.nombre || '',
    placeholder: 'Ej. Camila',
  });
  const inputApellido = el('input', {
    id: 'p-apellido',
    type: 'text',
    className: 'input',
    maxLength: 120,
    value: existing?.apellido || '',
    placeholder: 'Opcional',
  });

  const locOptions = state.localidades.map((l) => ({
    value: l.id,
    label: l.activa ? l.nombre : `${l.nombre} (Inactiva)`,
  }));
  const selectLoc = el(
    'select',
    { id: 'p-localidad', className: 'select' },
    createSelectOptions(locOptions, existing?.localidad_id, 'Sin localidad asignada')
  );

  const inputSector = el('input', {
    id: 'p-sector',
    type: 'text',
    className: 'input',
    maxLength: 160,
    value: existing?.sector || '',
    placeholder: 'Ej. Rahue Alto, Centro, sector rural…',
  });

  const inputFechaInc = el('input', {
    id: 'p-fecha-inc',
    type: 'date',
    className: 'input',
    value: existing?.fecha_incorporacion || '',
  });

  const medioOptions = (state.categorias.medio_comunicacion || [])
    .filter((c) => c.activa)
    .map((c) => ({ value: c.clave, label: c.etiqueta }));
  const selectMedio = el(
    'select',
    { id: 'p-medio', className: 'select' },
    createSelectOptions(medioOptions, existing?.medio_comunicacion, 'Sin especificar')
  );

  const triOptions = [
    { value: '1', label: 'Sí' },
    { value: '0', label: 'No' },
  ];
  const selectUsaLsch = el(
    'select',
    { id: 'p-usa-lsch', className: 'select' },
    createSelectOptions(triOptions, triBoolValue(existing?.usa_lsch), 'Por confirmar / Sin especificar')
  );

  const nivelOptions = (state.categorias.nivel_lsch || [])
    .filter((c) => c.activa)
    .map((c) => ({ value: c.clave, label: c.etiqueta }));
  const selectNivelLsch = el(
    'select',
    { id: 'p-nivel-lsch', className: 'select' },
    createSelectOptions(nivelOptions, existing?.nivel_lsch, 'Sin especificar')
  );

  const nivelFieldWrap = el(
    'div',
    { className: 'field' },
    el('label', { className: 'field-label', for: 'p-nivel-lsch', text: 'Nivel de LSCh (si corresponde)' }),
    selectNivelLsch
  );

  const syncNivelVisibility = () => {
    const noUsa = selectUsaLsch.value === '0';
    selectNivelLsch.disabled = noUsa;
    if (noUsa) {
      selectNivelLsch.value = 'no_aplica';
    }
  };
  selectUsaLsch.addEventListener('change', syncNivelVisibility);
  syncNivelVisibility();

  const selectEscrita = el(
    'select',
    { id: 'p-escrita', className: 'select' },
    createSelectOptions(triOptions, triBoolValue(existing?.prefiere_escrita), 'Sin especificar')
  );

  const selectInterp = el(
    'select',
    { id: 'p-interp', className: 'select' },
    createSelectOptions(triOptions, triBoolValue(existing?.necesita_interpretacion), 'Por confirmar / Sin especificar')
  );

  const inputObsCom = el('textarea', {
    id: 'p-obs-com',
    className: 'textarea',
    maxLength: 1500,
    placeholder: 'Detalles útiles para comunicarse con respeto y claridad…',
    text: existing?.observaciones_comunicacion || '',
  });
  inputObsCom.value = existing?.observaciones_comunicacion || '';

  const estadoOptions = (state.categorias.estado_registro || [])
    .filter((c) => c.activa)
    .map((c) => ({ value: c.clave, label: c.etiqueta }));
  const selectEstado = el(
    'select',
    { id: 'p-estado', className: 'select' },
    createSelectOptions(estadoOptions, existing?.estado || 'por_confirmar', null)
  );

  const inputUltVisita = el('input', {
    id: 'p-ult-visita',
    type: 'date',
    className: 'input',
    value: existing?.fecha_ultima_visita || '',
  });

  const inputProxAccion = el('input', {
    id: 'p-prox-accion',
    type: 'text',
    className: 'input',
    maxLength: 300,
    value: existing?.proxima_accion || '',
    placeholder: 'Ej. Confirmar disponibilidad para visita',
  });

  const inputObs = el('textarea', {
    id: 'p-obs',
    className: 'textarea',
    maxLength: 2000,
    placeholder: 'Observaciones de seguimiento territorial (evita incluir datos médicos o domicilios exactos).',
  });
  inputObs.value = existing?.observaciones || '';

  const checkConsent = el('input', {
    id: 'p-consent',
    type: 'checkbox',
    checked: isEdit ? Boolean(existing.consentimiento_registrado) : false,
  });

  const inputNotaConsent = el('input', {
    id: 'p-nota-consent',
    type: 'text',
    className: 'input',
    maxLength: 400,
    value: existing?.nota_consentimiento || '',
    placeholder: 'Opcional: ej. Consentimiento verbal en visita',
  });

  const form = el(
    'form',
    { id: 'person-form', noValidate: true },
    errorBanner,
    el(
      'div',
      { className: 'form-section' },
      el('h3', { className: 'form-section-title', text: '1. Información general' }),
      el(
        'div',
        { className: 'form-grid' },
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-nombre', text: 'Nombre *' }), inputNombre),
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-apellido', text: 'Apellido' }), inputApellido),
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-localidad', text: 'Localidad' }), selectLoc),
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-sector', text: 'Sector o barrio' }), inputSector),
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-fecha-inc', text: 'Fecha de incorporación' }), inputFechaInc)
      )
    ),
    el(
      'div',
      { className: 'form-section' },
      el('h3', { className: 'form-section-title', text: '2. Comunicación y accesibilidad' }),
      el(
        'div',
        { className: 'form-grid' },
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-medio', text: 'Medio de comunicación preferido' }), selectMedio),
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-usa-lsch', text: '¿Utiliza LSCh?' }), selectUsaLsch),
        nivelFieldWrap,
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-escrita', text: '¿Prefiere comunicación escrita?' }), selectEscrita),
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-interp', text: '¿Necesita interpretación?' }), selectInterp),
        el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 'p-obs-com', text: 'Observaciones relevantes de comunicación' }), inputObsCom)
      )
    ),
    el(
      'div',
      { className: 'form-section' },
      el('h3', { className: 'form-section-title', text: '3. Seguimiento y resguardo de datos' }),
      el(
        'div',
        { className: 'form-grid' },
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-estado', text: 'Estado del registro' }), selectEstado),
        el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'p-ult-visita', text: 'Fecha de última visita' }), inputUltVisita),
        el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 'p-prox-accion', text: 'Próxima acción pendiente' }), inputProxAccion),
        el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 'p-obs', text: 'Observaciones generales' }), inputObs),
        el(
          'div',
          { className: 'field col-span-2' },
          el(
            'label',
            { className: 'checkbox-row', for: 'p-consent' },
            checkConsent,
            el('span', {
              text: isEdit
                ? 'Consentimiento registrado para mantener esta ficha territorial.'
                : 'Confirmo que se cuenta con consentimiento adecuado para incorporar estos datos personales *',
            })
          )
        ),
        el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 'p-nota-consent', text: 'Nota de consentimiento (opcional)' }), inputNotaConsent)
      )
    )
  );

  const saveBtn = el('button', {
    type: 'submit',
    form: 'person-form',
    className: 'btn btn-primary',
    text: isEdit ? 'Guardar cambios' : 'Registrar persona',
  });
  const cancelBtn = el('button', {
    type: 'button',
    className: 'btn btn-outline',
    text: 'Cancelar',
    onClick: () => closeModal(),
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBanner.classList.add('hidden');
    saveBtn.disabled = true;

    const payload = {
      nombre: inputNombre.value.trim(),
      apellido: inputApellido.value.trim(),
      localidad_id: selectLoc.value ? Number(selectLoc.value) : null,
      sector: inputSector.value.trim(),
      congregacion_id: existing?.congregacion_id ?? null,
      fecha_incorporacion: inputFechaInc.value || null,
      medio_comunicacion: selectMedio.value,
      usa_lsch: parseTriSelect(selectUsaLsch.value),
      nivel_lsch: selectNivelLsch.value,
      prefiere_escrita: parseTriSelect(selectEscrita.value),
      necesita_interpretacion: parseTriSelect(selectInterp.value),
      observaciones_comunicacion: inputObsCom.value.trim(),
      estado: selectEstado.value,
      fecha_ultima_visita: inputUltVisita.value || null,
      proxima_accion: inputProxAccion.value.trim(),
      observaciones: inputObs.value.trim(),
      consentimiento_registrado: checkConsent.checked ? 1 : 0,
      nota_consentimiento: inputNotaConsent.value.trim(),
    };

    try {
      const res = isEdit
        ? await apiFetch(`/api/personas/${existing.id}`, { method: 'PUT', body: payload })
        : await apiFetch('/api/personas', { method: 'POST', body: payload });

      closeModal();
      showToast(isEdit ? 'Registro actualizado correctamente.' : 'Persona registrada correctamente.', 'success');
      if (onSaved) onSaved(res.persona);
    } catch (err) {
      saveBtn.disabled = false;
      errorBanner.textContent = err.message || 'No se pudo guardar el registro.';
      errorBanner.classList.remove('hidden');
      errorBanner.scrollIntoView({ block: 'nearest' });
    }
  });

  openModal({
    title: isEdit ? `Editar ficha — ${fullName(existing)}` : 'Registrar nueva persona',
    body: form,
    footer: [cancelBtn, saveBtn],
  });
}

export async function openPersonDetailModal(personId, onChanged = null) {
  openModal({
    title: 'Ficha de persona',
    body: renderLoading('Cargando ficha completa…'),
  });

  try {
    const { persona, seguimientos } = await apiFetch(`/api/personas/${personId}`);

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
          createBadge(
            getCategoryLabel(state.categorias, 'estado_registro', persona.estado, persona.estado),
            getStatusBadgeClass(persona.estado)
          )
        ),
        el(
          'div',
          { className: 'detail-grid' },
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Localidad' }), el('span', { className: 'detail-val', text: persona.localidad_nombre || 'Sin asignar' })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Sector o barrio' }), el('span', { className: 'detail-val', text: persona.sector || '—' })),
          persona.congregacion_nombre
            ? el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Congregación' }), el('span', { className: 'detail-val', text: persona.congregacion_nombre }))
            : null,
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
        el('h3', { className: 'form-section-title', text: 'Seguimiento y actualización' }),
        el(
          'div',
          { className: 'detail-grid' },
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Última visita' }), el('span', { className: 'detail-val', text: formatDate(persona.fecha_ultima_visita) })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Próxima acción' }), el('span', { className: 'detail-val', text: persona.proxima_accion || '—' })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Última actualización' }), el('span', { className: 'detail-val', text: formatDateTime(persona.fecha_actualizacion) })),
          el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Consentimiento' }), el('span', { className: 'detail-val', text: persona.consentimiento_registrado ? `Registrado (${formatDate(persona.fecha_consentimiento)})` : 'Pendiente' }))
        ),
        persona.observaciones
          ? el('p', { style: { marginTop: '10px', fontSize: '0.9rem' }, text: `Observaciones: ${persona.observaciones}` })
          : null
      ),
      el(
        'div',
        { className: 'form-section' },
        el(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } },
          el('h3', { className: 'form-section-title', style: { marginBottom: 0, borderBottom: 0, paddingBottom: 0 }, text: `Historial de seguimientos (${seguimientos.length})` }),
          state.authenticated
            ? el('button', {
                type: 'button',
                className: 'btn btn-secondary btn-xs',
                text: '+ Nuevo seguimiento',
                onClick: () => openSeguimientoFormModal({ persona_id: persona.id, localidad_id: persona.localidad_id }, () => {
                  openPersonDetailModal(persona.id, onChanged);
                  if (onChanged) onChanged();
                }),
              })
            : null
        ),
        seguimientos.length
          ? el(
              'ul',
              { className: 'activity-list' },
              seguimientos.map((s) =>
                el(
                  'li',
                  { className: 'activity-item' },
                  el(
                    'div',
                    {},
                    el('div', { className: 'activity-title', text: `${getCategoryLabel(state.categorias, 'tipo_seguimiento', s.tipo, s.tipo)} — ${formatDate(s.fecha)}` }),
                    el('div', { className: 'activity-meta', text: s.descripcion })
                  ),
                  createBadge(getCategoryLabel(state.categorias, 'estado_seguimiento', s.estado, s.estado), getStatusBadgeClass(s.estado))
                )
              )
            )
          : el('p', { className: 'field-hint', text: 'Aún no hay seguimientos registrados para esta persona.' })
      )
    );

    const footer = state.authenticated
      ? [
          el('button', {
            type: 'button',
            className: 'btn btn-ghost-danger',
            text: 'Eliminar',
            onClick: () =>
              openConfirmDialog({
                title: 'Eliminar registro',
                message: `¿Seguro que deseas eliminar la ficha de ${fullName(persona)} (${persona.codigo_interno})? También se eliminarán sus seguimientos asociados.`,
                confirmLabel: 'Sí, eliminar',
                onConfirm: async () => {
                  await apiFetch(`/api/personas/${persona.id}`, { method: 'DELETE' });
                  showToast('Registro eliminado.', 'success');
                  if (onChanged) onChanged();
                },
              }),
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-outline',
            text: 'Editar',
            onClick: () => openPersonFormModal(persona, onChanged),
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-primary',
            text: 'Cerrar',
            onClick: () => closeModal(),
          }),
        ]
      : [
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

export function openLocalidadFormModal(existing = null, onSaved = null) {
  if (!ensureAdminOrWarn()) return;
  const isEdit = Boolean(existing && existing.id);
  const errBox = el('div', { className: 'alert alert-error hidden', role: 'alert' });

  const inNombre = el('input', { id: 'l-nombre', type: 'text', className: 'input', required: true, maxLength: 100, value: existing?.nombre || '', placeholder: 'Ej. Río Negro' });
  const inRegion = el('input', { id: 'l-region', type: 'text', className: 'input', maxLength: 100, value: existing?.region || '', placeholder: 'Ej. Región de Los Lagos' });
  const inDesc = el('textarea', { id: 'l-desc', className: 'textarea', maxLength: 500, placeholder: 'Descripción territorial amplia de la localidad…' });
  inDesc.value = existing?.descripcion || '';
  const inLat = el('input', { id: 'l-lat', type: 'number', step: '0.0001', className: 'input', value: existing?.latitud ?? '', placeholder: 'Ej. -40.5739 (opcional)' });
  const inLng = el('input', { id: 'l-lng', type: 'number', step: '0.0001', className: 'input', value: existing?.longitud ?? '', placeholder: 'Ej. -73.1335 (opcional)' });
  const chkActiva = el('input', { id: 'l-activa', type: 'checkbox', checked: isEdit ? Boolean(existing.activa) : true });

  const form = el(
    'form',
    { id: 'loc-form', noValidate: true },
    errBox,
    el(
      'div',
      { className: 'form-grid' },
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'l-nombre', text: 'Nombre de la localidad *' }), inNombre),
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'l-region', text: 'Región / zona' }), inRegion),
      el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 'l-desc', text: 'Descripción' }), inDesc),
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'l-lat', text: 'Latitud referencial del centro' }), inLat),
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'l-lng', text: 'Longitud referencial del centro' }), inLng),
      el('div', { className: 'field col-span-2' }, el('p', { className: 'field-hint', text: 'Privacidad: las coordenadas son opcionales y deben corresponder únicamente al centro general de la localidad, nunca a domicilios personales.' })),
      el('div', { className: 'field col-span-2' }, el('label', { className: 'checkbox-row', for: 'l-activa' }, chkActiva, el('span', { text: 'Localidad activa para nuevos registros' })))
    )
  );

  const submitBtn = el('button', { type: 'submit', form: 'loc-form', className: 'btn btn-primary', text: isEdit ? 'Guardar cambios' : 'Crear localidad' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    submitBtn.disabled = true;

    const payload = {
      nombre: inNombre.value.trim(),
      region: inRegion.value.trim(),
      descripcion: inDesc.value.trim(),
      latitud: inLat.value.trim() === '' ? null : Number(inLat.value),
      longitud: inLng.value.trim() === '' ? null : Number(inLng.value),
      activa: chkActiva.checked ? 1 : 0,
    };

    try {
      const res = isEdit
        ? await apiFetch(`/api/localidades/${existing.id}`, { method: 'PUT', body: payload })
        : await apiFetch('/api/localidades', { method: 'POST', body: payload });
      await refreshReferenceData();
      closeModal();
      showToast(isEdit ? 'Localidad actualizada.' : 'Localidad agregada.', 'success');
      if (onSaved) onSaved(res.localidad);
    } catch (err) {
      submitBtn.disabled = false;
      errBox.textContent = err.message || 'No se pudo guardar la localidad.';
      errBox.classList.remove('hidden');
    }
  });

  openModal({
    title: isEdit ? `Editar localidad — ${existing.nombre}` : 'Nueva localidad',
    body: form,
    footer: [el('button', { type: 'button', className: 'btn btn-outline', text: 'Cancelar', onClick: () => closeModal() }), submitBtn],
  });
}

export function openCongregacionFormModal(existing = null, onSaved = null) {
  if (!ensureAdminOrWarn()) return;
  const isEdit = Boolean(existing && existing.id);
  const errBox = el('div', { className: 'alert alert-error hidden', role: 'alert' });

  const inNombre = el('input', { id: 'c-nombre', type: 'text', className: 'input', required: true, maxLength: 120, value: existing?.nombre || '', placeholder: 'Ej. Señas Osorno / Congregación Norte' });
  const locOptions = state.localidades.map((l) => ({ value: l.id, label: l.nombre }));
  const selPrimary = el('select', { id: 'c-loc-primary', className: 'select' }, createSelectOptions(locOptions, existing?.localidad_id, 'Sin localidad principal específica'));
  const inDesc = el('textarea', { id: 'c-desc', className: 'textarea', maxLength: 500, placeholder: 'Notas organizativas o alcance territorial…' });
  inDesc.value = existing?.descripcion || '';

  const coveredSet = new Set((existing?.localidades_cubiertas || []).map((l) => Number(l.id)));
  const checkboxes = state.localidades.map((loc) => {
    const cb = el('input', { type: 'checkbox', value: String(loc.id), checked: coveredSet.has(Number(loc.id)) });
    return el('label', { className: 'checkbox-row' }, cb, el('span', { text: loc.nombre }));
  });

  const chkActiva = el('input', { id: 'c-activa', type: 'checkbox', checked: isEdit ? Boolean(existing.activa) : true });

  const form = el(
    'form',
    { id: 'cong-form', noValidate: true },
    errBox,
    el(
      'div',
      { className: 'form-grid' },
      el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 'c-nombre', text: 'Nombre de la congregación *' }), inNombre),
      el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 'c-loc-primary', text: 'Localidad de referencia (opcional)' }), selPrimary),
      el(
        'div',
        { className: 'field col-span-2' },
        el('span', { className: 'field-label', text: 'Localidades que abarca o apoya (opcional, selección múltiple)' }),
        state.localidades.length
          ? el('div', { className: 'checkbox-grid' }, checkboxes)
          : el('p', { className: 'field-hint', text: 'Aún no hay localidades creadas.' })
      ),
      el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 'c-desc', text: 'Descripción' }), inDesc),
      el('div', { className: 'field col-span-2' }, el('label', { className: 'checkbox-row', for: 'c-activa' }, chkActiva, el('span', { text: 'Congregación activa' })))
    )
  );

  const submitBtn = el('button', { type: 'submit', form: 'cong-form', className: 'btn btn-primary', text: isEdit ? 'Guardar cambios' : 'Crear congregación' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    submitBtn.disabled = true;

    const selectedIds = Array.from(form.querySelectorAll('.checkbox-grid input[type="checkbox"]:checked')).map((elCb) => Number(elCb.value));
    const payload = {
      nombre: inNombre.value.trim(),
      localidad_id: selPrimary.value ? Number(selPrimary.value) : null,
      localidades_ids: selectedIds,
      descripcion: inDesc.value.trim(),
      activa: chkActiva.checked ? 1 : 0,
    };

    try {
      const res = isEdit
        ? await apiFetch(`/api/congregaciones/${existing.id}`, { method: 'PUT', body: payload })
        : await apiFetch('/api/congregaciones', { method: 'POST', body: payload });
      await refreshReferenceData();
      closeModal();
      showToast(isEdit ? 'Congregación actualizada.' : 'Congregación creada.', 'success');
      if (onSaved) onSaved(res.congregacion);
    } catch (err) {
      submitBtn.disabled = false;
      errBox.textContent = err.message || 'No se pudo guardar la congregación.';
      errBox.classList.remove('hidden');
    }
  });

  openModal({
    title: isEdit ? `Editar congregación — ${existing.nombre}` : 'Nueva congregación',
    body: form,
    footer: [el('button', { type: 'button', className: 'btn btn-outline', text: 'Cancelar', onClick: () => closeModal() }), submitBtn],
  });
}

export async function openSeguimientoFormModal(preset = null, onSaved = null) {
  if (!ensureAdminOrWarn()) return;
  const existing = preset?.id ? preset : null;
  const isEdit = Boolean(existing);
  const errBox = el('div', { className: 'alert alert-error hidden', role: 'alert' });

  let personasList = [];
  try {
    const pData = await apiFetch('/api/personas?limit=200&sort=nombre&order=asc');
    personasList = pData.items || [];
  } catch {
    personasList = [];
  }

  const personaOpts = personasList.map((p) => ({
    value: p.id,
    label: `${fullName(p)} (${p.codigo_interno})${p.localidad_nombre ? ` — ${p.localidad_nombre}` : ''}`,
  }));
  const selPersona = el(
    'select',
    { id: 's-persona', className: 'select' },
    createSelectOptions(personaOpts, preset?.persona_id, 'Seguimiento territorial general (sin persona específica)')
  );

  const locOpts = state.localidades.map((l) => ({ value: l.id, label: l.nombre }));
  const selLoc = el(
    'select',
    { id: 's-loc', className: 'select' },
    createSelectOptions(locOpts, preset?.localidad_id, 'Según persona / Sin localidad específica')
  );

  const tipoOpts = (state.categorias.tipo_seguimiento || [])
    .filter((c) => c.activa)
    .map((c) => ({ value: c.clave, label: c.etiqueta }));
  const selTipo = el(
    'select',
    { id: 's-tipo', className: 'select' },
    createSelectOptions(tipoOpts, existing?.tipo || 'visita_pendiente', null)
  );

  const estadoOpts = (state.categorias.estado_seguimiento || [])
    .filter((c) => c.activa)
    .map((c) => ({ value: c.clave, label: c.etiqueta }));
  const selEstado = el(
    'select',
    { id: 's-estado', className: 'select' },
    createSelectOptions(estadoOpts, existing?.estado || 'pendiente', null)
  );

  const today = new Date().toISOString().slice(0, 10);
  const inFecha = el('input', {
    id: 's-fecha',
    type: 'date',
    className: 'input',
    required: true,
    value: existing?.fecha || today,
  });

  const inDesc = el('textarea', {
    id: 's-desc',
    className: 'textarea',
    required: true,
    maxLength: 2000,
    placeholder: 'Describe el motivo, resultado de la visita o próxima acción acordada…',
  });
  inDesc.value = existing?.descripcion || '';

  const form = el(
    'form',
    { id: 'seg-form', noValidate: true },
    errBox,
    el(
      'div',
      { className: 'form-grid' },
      el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 's-persona', text: 'Persona asociada (cuando corresponda)' }), selPersona),
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 's-loc', text: 'Localidad' }), selLoc),
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 's-fecha', text: 'Fecha *' }), inFecha),
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 's-tipo', text: 'Tipo de seguimiento *' }), selTipo),
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 's-estado', text: 'Estado *' }), selEstado),
      el('div', { className: 'field col-span-2' }, el('label', { className: 'field-label', for: 's-desc', text: 'Descripción *' }), inDesc)
    )
  );

  const submitBtn = el('button', { type: 'submit', form: 'seg-form', className: 'btn btn-primary', text: isEdit ? 'Guardar cambios' : 'Registrar seguimiento' });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    submitBtn.disabled = true;

    const payload = {
      persona_id: selPersona.value ? Number(selPersona.value) : null,
      localidad_id: selLoc.value ? Number(selLoc.value) : null,
      tipo: selTipo.value,
      estado: selEstado.value,
      fecha: inFecha.value,
      descripcion: inDesc.value.trim(),
    };

    try {
      const res = isEdit
        ? await apiFetch(`/api/seguimientos/${existing.id}`, { method: 'PUT', body: payload })
        : await apiFetch('/api/seguimientos', { method: 'POST', body: payload });
      closeModal();
      showToast(isEdit ? 'Seguimiento actualizado.' : 'Seguimiento registrado.', 'success');
      if (onSaved) onSaved(res.seguimiento);
    } catch (err) {
      submitBtn.disabled = false;
      errBox.textContent = err.message || 'No se pudo guardar el seguimiento.';
      errBox.classList.remove('hidden');
    }
  });

  openModal({
    title: isEdit ? 'Editar seguimiento' : 'Registrar seguimiento territorial',
    body: form,
    footer: [el('button', { type: 'button', className: 'btn btn-outline', text: 'Cancelar', onClick: () => closeModal() }), submitBtn],
  });
}

