/**
 * Configuración de conexión entre el frontend (GitHub Pages / dominio propio)
 * y el backend en Cloudflare Workers.
 *
 * IMPORTANTE:
 * - No coloques secretos, tokens ni credenciales aquí.
 * - Al desplegar en GitHub Pages con el Worker en otro dominio o subdominio,
 *   indica la URL pública del Worker (sin barra final), por ejemplo:
 *   'https://api.tudominio.cl' o 'https://senasconecta-api.tu-subdominio.workers.dev'
 * - Si sirves frontend y API bajo el mismo origen (ej. pruebas locales o proxy /api),
 *   deja el valor vacío ('').
 */

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOCAL_STATIC_DEV_PORTS = new Set(['5500', '5501', '5173', '3000', '4173', '8000', '8080']);

export const CONFIG = {
  API_BASE_URL: '',
};

export function getApiBaseUrl() {
  const override = String(window.SENASCONECTA_API_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (override) {
    return override;
  }

  const host = String(window.location.hostname || '').trim();
  const port = String(window.location.port || '').trim();
  if (LOCAL_DEV_HOSTS.has(host) && LOCAL_STATIC_DEV_PORTS.has(port)) {
    const apiHost = host === '::1' || host === '[::1]' ? '[::1]' : host;
    return `http://${apiHost}:8787`;
  }

  return String(CONFIG.API_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
}

export function isApiUrlConfigured() {
  const base = getApiBaseUrl();
  if (base) return true;
  const host = window.location.hostname;
  return LOCAL_DEV_HOSTS.has(host);
}

