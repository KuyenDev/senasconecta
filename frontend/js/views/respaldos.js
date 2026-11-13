/**
 * Vista del módulo de Respaldos (exportación local CSV/JSON e importación JSON validada).
 */

import { apiFetch, refreshReferenceData } from '../api.js';
import { startLoginRedirect } from '../auth.js';
import { closeModal, openModal, renderEmptyState, showToast } from '../components.js';
import { state } from '../state.js';
import { clearNode, downloadBlob, el } from '../utils.js';

export async function renderRespaldosView(container) {
  clearNode(container);

  if (!state.authenticated) {
    container.appendChild(
      el(
        'section',
        { className: 'card' },
        renderEmptyState(
          'Acceso administrativo requerido',
          'La descarga de respaldos completos (CSV/JSON), la importación de datos y la información de sesión están restringidas al administrador autorizado mediante GitHub.',
          el('button', {
            type: 'button',
            className: 'btn btn-primary',
            text: 'Ingresar con GitHub',
            onClick: () => {
              if (!state.oauthConfigured) {
                showToast('La autenticación GitHub OAuth aún no está configurada en el servidor.', 'error');
                return;
              }
              const res = startLoginRedirect();
              if (!res.ok) {
                showToast('Configura la URL del Cloudflare Worker antes de iniciar sesión.', 'error');
              }
            },
          })
        )
      )
    );
    return;
  }

  const exportCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: 'Exportar respaldos locales' }),
        el('p', {
          className: 'card-subtitle',
          text: 'Los archivos se descargan directamente en tu dispositivo. Nunca se envían a repositorios públicos.',
        })
      )
    ),
    el(
      'div',
      { className: 'card-body' },
      el(
        'div',
        { className: 'grid-2' },
        el(
          'div',
          { className: 'territory-card' },
          el('h3', { className: 'card-title', text: 'Respaldo completo en JSON' }),
          el('p', {
            className: 'field-hint',
            text: 'Incluye localidades, congregaciones, personas y seguimientos en formato estructurado para restaurar o migrar datos.',
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-primary',
            text: 'Descargar respaldo JSON',
            onClick: () => triggerDownload('json'),
          })
        ),
        el(
          'div',
          { className: 'territory-card' },
          el('h3', { className: 'card-title', text: 'Planilla CSV de personas' }),
          el('p', {
            className: 'field-hint',
            text: 'Archivo compatible con Excel y LibreOffice Calc (UTF-8 con BOM y protección contra inyección de fórmulas).',
          }),
          el('button', {
            type: 'button',
            className: 'btn btn-secondary',
            text: 'Descargar planilla CSV',
            onClick: () => triggerDownload('csv'),
          })
        )
      )
    )
  );

  async function triggerDownload(formato) {
    try {
      const response = await apiFetch(`/api/respaldos/exportar?formato=${formato}`, {
        rawResponse: true,
      });
      const blob = await response.blob();
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename =
        formato === 'csv'
          ? `senasconecta-personas-${dateStr}.csv`
          : `senasconecta-respaldo-${dateStr}.json`;
      downloadBlob(blob, filename);
      showToast(`Archivo ${filename} descargado correctamente.`, 'success');
    } catch (err) {
      showToast(err.message || 'No se pudo generar la exportación.', 'error');
    }
  }

  // Importación JSON con vista previa y confirmación
  const fileInput = el('input', {
    id: 'import-json-file',
    type: 'file',
    accept: '.json,application/json',
    className: 'input',
  });

  const selStrategy = el(
    'select',
    { id: 'import-strategy', className: 'select' },
    el('option', { value: 'omitir', text: 'Omitir duplicados existentes (solo agregar nuevos)' }),
    el('option', { value: 'actualizar', text: 'Actualizar registros existentes y agregar nuevos' })
  );

  const importErr = el('div', { className: 'alert alert-error hidden', role: 'alert' });
  const resultBox = el('div', { className: 'hidden', style: { marginTop: '16px' } });
  const btnAnalyze = el('button', {
    type: 'button',
    className: 'btn btn-primary',
    text: 'Validar archivo y previsualizar',
  });

  function buildSummaryTable(resumen) {
    const sections = [
      ['Localidades', resumen.localidades],
      ['Congregaciones', resumen.congregaciones],
      ['Personas', resumen.personas],
      ['Seguimientos', resumen.seguimientos],
      ['Total general', resumen.totales],
    ];

    return el(
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
            el('th', { scope: 'col', text: 'Sección' }),
            el('th', { scope: 'col', text: 'Nuevos' }),
            el('th', { scope: 'col', text: 'Modificados' }),
            el('th', { scope: 'col', text: 'Omitidos' }),
            el('th', { scope: 'col', text: 'Rechazados' })
          )
        ),
        el(
          'tbody',
          {},
          sections.map(([label, counts]) =>
            el(
              'tr',
              { style: label === 'Total general' ? { fontWeight: '700', background: 'var(--bg-beige-soft)' } : {} },
              el('td', { text: label }),
              el('td', { text: String(counts?.nuevos || 0) }),
              el('td', { text: String(counts?.modificados || 0) }),
              el('td', { text: String(counts?.omitidos || 0) }),
              el('td', { text: String(counts?.rechazados || 0) })
            )
          )
        )
      )
    );
  }

  function buildErrorsList(errores) {
    if (!errores || !errores.length) return null;
    return el(
      'div',
      { className: 'alert alert-warning', style: { marginTop: '14px' } },
      el('strong', { text: `Observaciones de validación (${errores.length}):` }),
      el(
        'ul',
        { style: { margin: '8px 0 0 18px', padding: 0 } },
        errores.slice(0, 15).map((e) =>
          el('li', { text: `[${e.seccion} · ${e.referencia}] ${e.motivo}` })
        )
      )
    );
  }

  btnAnalyze.addEventListener('click', async () => {
    importErr.classList.add('hidden');
    resultBox.classList.add('hidden');

    const file = fileInput.files?.[0];
    if (!file) {
      importErr.textContent = 'Selecciona primero un archivo JSON de respaldo.';
      importErr.classList.remove('hidden');
      return;
    }

    let parsedJson;
    try {
      const text = await file.text();
      parsedJson = JSON.parse(text);
    } catch {
      importErr.textContent = 'El archivo seleccionado no contiene JSON válido.';
      importErr.classList.remove('hidden');
      return;
    }

    btnAnalyze.disabled = true;
    btnAnalyze.textContent = 'Validando estructura…';

    try {
      const strategy = selStrategy.value;
      const preview = await apiFetch('/api/respaldos/previsualizar', {
        method: 'POST',
        body: { respaldo: parsedJson, estrategia_duplicados: strategy },
      });

      btnAnalyze.disabled = false;
      btnAnalyze.textContent = 'Validar archivo y previsualizar';

      const confirmBtn = el('button', {
        type: 'button',
        className: 'btn btn-primary',
        text: 'Confirmar e importar respaldo',
      });

      const modalBody = el(
        'div',
        {},
        el('p', {
          style: { marginBottom: '12px' },
          text: 'Revisa el resultado de la validación antes de aplicar cambios en la base de datos:',
        }),
        buildSummaryTable(preview.resumen),
        buildErrorsList(preview.errores)
      );

      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Importando…';
        try {
          const imported = await apiFetch('/api/respaldos/importar', {
            method: 'POST',
            body: {
              respaldo: parsedJson,
              estrategia_duplicados: strategy,
              confirmado: true,
            },
          });
          await refreshReferenceData();
          closeModal();

          clearNode(resultBox);
          resultBox.classList.remove('hidden');
          resultBox.appendChild(
            el(
              'div',
              { className: 'alert alert-success' },
              `Importación finalizada: ${imported.resumen.totales.nuevos} nuevos, ${imported.resumen.totales.modificados} modificados, ${imported.resumen.totales.omitidos} omitidos y ${imported.resumen.totales.rechazados} rechazados.`
            )
          );
          resultBox.appendChild(buildSummaryTable(imported.resumen));
          const errEl = buildErrorsList(imported.errores);
          if (errEl) resultBox.appendChild(errEl);

          fileInput.value = '';
          showToast('Respaldo importado correctamente.', 'success');
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirmar e importar respaldo';
          showToast(err.message || 'Error al importar el respaldo.', 'error');
        }
      });

      openModal({
        title: 'Confirmar importación de respaldo',
        body: modalBody,
        footer: [
          el('button', { type: 'button', className: 'btn btn-outline', text: 'Cancelar', onClick: () => closeModal() }),
          confirmBtn,
        ],
      });
    } catch (err) {
      btnAnalyze.disabled = false;
      btnAnalyze.textContent = 'Validar archivo y previsualizar';
      importErr.textContent = err.message || 'No se pudo validar el archivo.';
      importErr.classList.remove('hidden');
    }
  });

  const importCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: 'Importar respaldo JSON' }),
        el('p', {
          className: 'card-subtitle',
          text: 'Se valida la estructura completa y se previenen duplicados antes de aplicar cambios.',
        })
      )
    ),
    el(
      'div',
      { className: 'card-body' },
      importErr,
      el(
        'div',
        { className: 'form-grid' },
        el(
          'div',
          { className: 'field' },
          el('label', { className: 'field-label', for: 'import-json-file', text: 'Archivo de respaldo (.json)' }),
          fileInput
        ),
        el(
          'div',
          { className: 'field' },
          el('label', { className: 'field-label', for: 'import-strategy', text: 'Manejo de duplicados' }),
          selStrategy
        )
      ),
      el('div', { style: { marginTop: '14px' } }, btnAnalyze),
      resultBox
    )
  );

  // Tarjeta informativa de seguridad y sesión
  const modeDesc =
    state.cookieMode === 'cross-site-none'
      ? 'Dominios separados (SameSite=None; Secure; HttpOnly + CSRF)'
      : state.cookieMode === 'same-site-domain'
        ? 'Mismo dominio registrable (SameSite=Lax; Secure; HttpOnly + CSRF)'
        : 'Mismo origen / Local (SameSite=Lax; HttpOnly + CSRF)';

  const secCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el('h2', { className: 'card-title', text: 'Estado de seguridad de la sesión' })
    ),
    el(
      'div',
      { className: 'card-body' },
      el(
        'div',
        { className: 'detail-grid' },
        el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Modo de cookie' }), el('span', { className: 'detail-val', text: modeDesc })),
        el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Administrador activo' }), el('span', { className: 'detail-val', text: state.admin ? `@${state.admin.login}` : '—' }))
      )
    )
  );

  container.appendChild(exportCard);
  container.appendChild(importCard);
  container.appendChild(secCard);
}

