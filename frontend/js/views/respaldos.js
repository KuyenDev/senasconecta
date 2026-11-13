/**
 * Vista de Exportación, origen Excel/JSON y vista previa local de respaldos.
 */

import {
  apiFetch,
  previewLocalJsonBackup,
  restorePublishedJsonData,
} from '../api.js';
import { showToast } from '../components.js';
import { state } from '../state.js';
import { clearNode, downloadBlob, el, formatDate, formatDateTime } from '../utils.js';

async function triggerDownload(formato) {
  try {
    const res = await apiFetch(`/api/respaldos/exportar?formato=${encodeURIComponent(formato)}`, {
      rawResponse: true,
    });
    const blob = await res.blob();
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = formato === 'csv' ? `senasconecta_personas_${stamp}.csv` : `senasconecta_respaldo_${stamp}.json`;
    downloadBlob(blob, filename);
    showToast(`Descarga ${formato.toUpperCase()} generada correctamente.`, 'success');
  } catch (err) {
    showToast(err.message || 'No se pudo generar la exportación.', 'error');
  }
}

export async function renderRespaldosView(container, { navigateTo, refreshMetaUi } = {}) {
  clearNode(container);

  const meta = state.meta || {};
  const totales = meta.totales || {};

  const btnCsv = el('button', {
    type: 'button',
    className: 'btn btn-primary',
    text: 'Descargar CSV (Excel)',
    onClick: () => triggerDownload('csv'),
  });

  const btnJson = el('button', {
    type: 'button',
    className: 'btn btn-outline',
    text: 'Descargar base JSON',
    onClick: () => triggerDownload('json'),
  });

  const exportCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: 'Exportar datos' }),
        el('p', {
          className: 'card-subtitle',
          text: 'Descarga los registros publicados en planilla CSV para Excel o como archivo JSON completo.',
        })
      )
    ),
    el(
      'div',
      { className: 'card-body', style: { display: 'grid', gap: '14px' } },
      el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, btnCsv, btnJson),
      el('p', {
        className: 'field-hint',
        text: 'El archivo CSV incluye codificación UTF-8 con BOM y protección contra inyección de fórmulas al abrirlo en Excel o LibreOffice Calc.',
      })
    )
  );

  const metaCard = el(
    'section',
    { className: 'card' },
    el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: 'Estado de los datos JSON' }),
        el('p', {
          className: 'card-subtitle',
          text: 'Resumen de la última integración generada desde la carpeta datos/.',
        })
      )
    ),
    el(
      'div',
      { className: 'card-body', style: { display: 'grid', gap: '12px' } },
      el(
        'div',
        { className: 'detail-grid' },
        el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Grupo' }), el('span', { className: 'detail-val', text: meta.grupo || 'Grupo Señas Osorno' })),
        el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Última actualización' }), el('span', { className: 'detail-val', text: meta.ultima_actualizacion ? formatDateTime(meta.ultima_actualizacion) : '—' })),
        el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Localidades' }), el('span', { className: 'detail-val', text: String(totales.localidades ?? state.localidades.length) })),
        el('div', { className: 'detail-item' }, el('span', { className: 'detail-label', text: 'Personas / Seguimientos' }), el('span', { className: 'detail-val', text: `${totales.personas ?? 0} / ${totales.seguimientos ?? 0}` }))
      ),
      el(
        'div',
        { style: { fontSize: '0.88rem', color: 'var(--text-secondary)' } },
        el('strong', { text: 'Fuentes integradas (prioridad más reciente): ' }),
        el('span', {
          text: Array.isArray(meta.fuentes) && meta.fuentes.length
            ? meta.fuentes.map((f) => `${f.archivo} (${formatDate(f.fecha_entrega)})`).join(', ')
            : (Array.isArray(meta.fuentes_excel) && meta.fuentes_excel.length
              ? meta.fuentes_excel.join(', ')
              : 'plantilla_senasconecta.xlsx'),
        })
      ),
      Array.isArray(meta.archivos_requieren_revision) && meta.archivos_requieren_revision.length
        ? el(
            'div',
            { className: 'alert alert-warning', style: { marginBottom: 0 } },
            `Archivos que requieren extracción/revisión asistida (PDF, imágenes o formatos antiguos): ${meta.archivos_requieren_revision.map((f) => `${f.archivo} (${formatDate(f.fecha_entrega)})`).join(', ')}.`
          )
        : null,
      el(
        'div',
        { className: 'alert alert-info', style: { marginBottom: 0 } },
        'Para actualizar los datos publicados: coloca archivos (.xlsx, .ods, .csv, .tsv, .json, .docx, .odt, .txt, .md) con su fecha de entrega en datos/ (por ejemplo 2026-11-15_osorno.docx) y ejecuta "python3 scripts/publicar.py". Siempre prevalecen los datos de fecha más reciente.'
      )
    )
  );

  const fileInput = el('input', {
    id: 'preview-json-file',
    type: 'file',
    accept: '.json,application/json',
    className: 'input',
  });

  const errorBox = el('div', { className: 'alert alert-error hidden' });
  const btnPreview = el('button', {
    type: 'button',
    className: 'btn btn-secondary',
    text: 'Previsualizar respaldo JSON',
  });

  const btnRestorePublished = el('button', {
    type: 'button',
    className: `btn btn-outline ${state.previewMode ? '' : 'hidden'}`,
    text: 'Volver a datos publicados',
    onClick: async () => {
      await restorePublishedJsonData();
      if (refreshMetaUi) refreshMetaUi();
      showToast('Volviste a los datos publicados en JSON.', 'info');
      await renderRespaldosView(container, { navigateTo, refreshMetaUi });
    },
  });

  btnPreview.addEventListener('click', async () => {
    errorBox.classList.add('hidden');
    const file = fileInput.files?.[0];
    if (!file) {
      errorBox.textContent = 'Selecciona primero un archivo .json exportado por SeñasConecta.';
      errorBox.classList.remove('hidden');
      return;
    }

    let parsed;
    try {
      const content = await file.text();
      parsed = JSON.parse(content);
    } catch {
      errorBox.textContent = 'No se pudo leer el archivo JSON seleccionado.';
      errorBox.classList.remove('hidden');
      return;
    }

    try {
      const snapshot = await previewLocalJsonBackup(parsed, file.name);
      if (refreshMetaUi) refreshMetaUi();
      showToast(
        `Vista previa cargada (${snapshot.personas.length} persona(s), ${snapshot.localidades.length} localidad(es)).`,
        'success'
      );
      await renderRespaldosView(container, { navigateTo, refreshMetaUi });
    } catch (err) {
      errorBox.textContent = err.message || 'El archivo JSON no tiene el formato esperado.';
      errorBox.classList.remove('hidden');
    }
  });

  const previewCard = el(
    'section',
    { className: 'card', style: { marginTop: '20px' } },
    el(
      'div',
      { className: 'card-header' },
      el(
        'div',
        {},
        el('h2', { className: 'card-title', text: 'Previsualizar archivo JSON en el navegador' }),
        el('p', {
          className: 'card-subtitle',
          text: 'Permite revisar temporalmente un archivo JSON local en toda la aplicación sin alterar los archivos publicados.',
        })
      )
    ),
    el(
      'div',
      { className: 'card-body', style: { display: 'grid', gap: '12px' } },
      errorBox,
      el('div', { className: 'field' }, el('label', { className: 'field-label', for: 'preview-json-file', text: 'Archivo JSON local' }), fileInput),
      el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, btnPreview, btnRestorePublished)
    )
  );

  container.appendChild(el('div', { className: 'grid-2' }, exportCard, metaCard));
  container.appendChild(previewCard);
}
