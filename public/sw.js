/*
 * Basic offline service worker. No build-time manifest, so it doesn't need to
 * know the hashed asset filenames: it caches the app shell on install and
 * caches everything else (same-origin GETs) as it's fetched.
 *
 * Bump CACHE to invalidate old caches on the next deploy.
 */
const CACHE = 'tt-cache-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add('./')) // the app shell (index.html)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the API — data and auth must always come from the network.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first (get fresh HTML when online), fall back to the
  // cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () =>
          caches.match('./', { ignoreSearch: true }) || caches.match(request),
      ),
    );
    return;
  }

  // Assets: stale-while-revalidate — serve cache instantly, refresh in the
  // background so updated builds get picked up.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fromNetwork = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fromNetwork;
    }),
  );
});
