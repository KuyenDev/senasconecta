/**
 * Service Worker PWA para SeñasConecta:
 * - Precachea el shell de la aplicación y la base JSON para uso inmediato sin conexión.
 * - Aplica Network-First en datos/*.json para mantener la información actualizada cuando hay red.
 * - Aplica Stale-While-Revalidate en archivos del shell y biblioteca Leaflet.
 * - Mantiene rutas relativas compatibles con subcarpetas de GitHub Pages (/senasconecta/).
 */

const CACHE_VERSION = 'v2';
const APP_CACHE = `senasconecta-shell-${CACHE_VERSION}`;
const DATA_CACHE = `senasconecta-data-${CACHE_VERSION}`;
const RUNTIME_CACHE = `senasconecta-runtime-${CACHE_VERSION}`;
const ACTIVE_CACHES = new Set([APP_CACHE, DATA_CACHE, RUNTIME_CACHE]);

const PRECACHE_SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './assets/favicon.svg',
  './assets/logo.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './js/app.js',
  './js/api.js',
  './js/charts.js',
  './js/components.js',
  './js/dataStore.js',
  './js/state.js',
  './js/utils.js',
  './js/xlsxExport.js',
  './js/views/dashboard.js',
  './js/views/personas.js',
  './js/views/territorio.js',
  './js/views/mapa.js',
  './js/views/estadisticas.js',
  './js/views/respaldos.js',
];

const PRECACHE_DATA_URLS = [
  './data/categorias.json',
  './data/localidades.json',
  './data/personas.json',
  './data/meta.json',
];

function isCacheableResponse(response) {
  return Boolean(response && response.ok && (response.type === 'basic' || response.type === 'cors'));
}

async function precacheAssets() {
  const shellCache = await caches.open(APP_CACHE);
  await shellCache.addAll(PRECACHE_SHELL_URLS);

  const dataCache = await caches.open(DATA_CACHE);
  await Promise.allSettled(
    PRECACHE_DATA_URLS.map(async (relPath) => {
      const response = await fetch(relPath, { cache: 'reload' });
      if (isCacheableResponse(response)) {
        await dataCache.put(relPath, response);
      }
    })
  );
}

async function networkFirst(request, cacheName, fallbackUrl = null) {
  const cache = await caches.open(cacheName);
  try {
    const networkResponse = await fetch(request);
    if (isCacheableResponse(networkResponse)) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (networkResponse) => {
      if (isCacheableResponse(networkResponse)) {
        await cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return new Response('Recurso no disponible sin conexión.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  });
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      precacheAssets().then(() => {
        // En la primera instalación toma el control inmediato para habilitar soporte offline al instante.
        if (self.registration && !self.registration.active) {
          return self.skipWaiting();
        }
        return undefined;
      })
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith('senasconecta-') && !ACTIVE_CACHES.has(key))
              .map((key) => caches.delete(key))
          )
        )
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    // Biblioteca Leaflet desde CDN para acelerar cargas posteriores del mapa
    if (url.origin === 'https://unpkg.com' && url.pathname.startsWith('/leaflet@')) {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
      return;
    }

    // No cachear tiles externos ni APIs de terceros
    if (url.origin !== self.location.origin) return;

    const scopeUrl = new URL(self.registration?.scope || './', self.location.origin);
    if (!url.pathname.startsWith(scopeUrl.pathname)) return;

    const relativePath = url.pathname.slice(scopeUrl.pathname.length);
    if (relativePath.startsWith('data/') && relativePath.endsWith('.json')) {
      event.respondWith(networkFirst(request, DATA_CACHE));
      return;
    }

    if (request.mode === 'navigate') {
      const indexFallback = new URL('./index.html', scopeUrl).toString();
      event.respondWith(networkFirst(request, APP_CACHE, indexFallback));
      return;
    }

    event.respondWith(staleWhileRevalidate(request, APP_CACHE));
  });
}

