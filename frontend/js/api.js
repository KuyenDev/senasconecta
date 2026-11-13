import { state } from './state.js';
import {
  activatePreviewSnapshot,
  clearPreviewSnapshot,
  getActiveDataset,
  isPreviewActive,
  queryDataEndpoint,
} from './dataStore.js';

export async function apiFetch(path, options = {}) {
  return await queryDataEndpoint(path, options);
}

export async function refreshReferenceData(forceReload = false) {
  const dataset = await getActiveDataset(forceReload);
  state.categorias = dataset.categorias || {};
  state.localidades = dataset.localidades || [];
  state.meta = dataset.meta || null;
  state.previewMode = isPreviewActive();
  state.previewLabel = state.previewMode ? (dataset.meta?.fuentes_excel?.[0] || 'Archivo local') : null;
  return dataset;
}

export async function previewLocalJsonBackup(rawBackup, fileName) {
  const snapshot = await activatePreviewSnapshot(rawBackup, fileName);
  state.categorias = snapshot.categorias || {};
  state.localidades = snapshot.localidades || [];
  state.meta = snapshot.meta || null;
  state.previewMode = true;
  state.previewLabel = fileName || 'Archivo local';
  return snapshot;
}

export async function restorePublishedJsonData() {
  const snapshot = await clearPreviewSnapshot();
  state.categorias = snapshot.categorias || {};
  state.localidades = snapshot.localidades || [];
  state.meta = snapshot.meta || null;
  state.previewMode = false;
  state.previewLabel = null;
  return snapshot;
}
