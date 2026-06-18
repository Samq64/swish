/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { version } from '$service-worker';

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

// This app is online-only: it can't run without the network and its data (D1
// via /api/*). The worker exists for ONE reason — when a top-level navigation
// fails offline, show a friendly page instead of the browser's error screen.
//
// It precaches ONLY the offline page, and stores a *reconstructed* response
// rather than what the network returned. Cloudflare serves text assets
// Brotli/gzip-encoded; a cached encoded response carries `Content-Encoding`
// headers whose body has already been decoded, so replaying it (especially into
// a navigation) double-decodes to an empty/corrupt page. `await res.text()` +
// a fresh `Response` drops those headers, giving a clean, navigation-safe copy.

const CACHE = `swish-offline-${version}`;
const OFFLINE_URL = '/offline.html';

/** Build a clean text/html response with no transfer-encoding metadata. */
const cleanHtml = (html) =>
  new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // `cache: 'reload'` bypasses the HTTP cache so we precache a fresh copy.
        const res = await fetch(OFFLINE_URL, { cache: 'reload' });
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(OFFLINE_URL, cleanHtml(await res.text()));
        }
      } catch {
        // Installed while offline, say — the worker still activates and will
        // precache the page on its next update.
      }
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  // Drop our OWN stale caches (old version-stamped offline shells), then take
  // control of open pages so the fix applies on next load. Crucially, only
  // touch caches we created (`swish-offline-*`): the Whisper model is cached by
  // transformers.js in its own `transformers-cache`, and nuking every cache
  // here would re-trigger a ~75 MB model download on every deploy.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('swish-offline-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only top-level navigations are handled; assets, /api/* and auth routes go
  // straight to the network, untouched and uncached. When a navigation fails
  // (offline), serve the precached offline page.
  if (request.mode !== 'navigate') return;
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
    ),
  );
});
