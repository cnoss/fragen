// Service worker: makes the app work offline.
//
// Online, everything is loaded fresh from the network (revalidated, bypassing the
// 10-minute HTTP cache of GitHub Pages), so new questions show up on the next start.
// The cache is only the offline fallback, or used when the network is too slow.

const CACHE = 'fragen-v1';
const NETWORK_TIMEOUT = 4000; // ms, then fall back to the cached copy

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'app/main.js',
  'app/store.js',
  'app/crypto.js',
  'app/styles.css',
  'app/fonts/archivo-black-latin-400-normal.woff2',
  'app/fonts/space-mono-latin-400-normal.woff2',
  'app/fonts/space-mono-latin-700-normal.woff2',
  'app/icons/icon-180.png',
  'app/icons/icon-192.png',
  'data/fragen.enc',
];

const url = (path) => new URL(path, self.registration.scope).href;
const fresh = (input) => new Request(input, { cache: 'no-cache' });

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES.map((path) => fresh(url(path))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  // All navigations show the same page, so they share one cache entry.
  const cacheKey = request.mode === 'navigate' ? url('index.html') : request;
  event.respondWith(networkFirst(event, request, cacheKey));
});

async function networkFirst(event, request, cacheKey) {
  const cache = await caches.open(CACHE);

  const network = fetch(fresh(request)).then((response) => {
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  });
  // Keep updating the cache even if we answer from it after the timeout.
  event.waitUntil(network.catch(() => {}));

  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT, 'timeout'));
  try {
    const result = await Promise.race([network, timeout]);
    if (result !== 'timeout') return result;
  } catch {
    // offline: fall through to the cache
  }
  const cached = await cache.match(cacheKey, { ignoreSearch: true });
  if (cached) return cached;
  return network.catch(() => Response.error());
}
