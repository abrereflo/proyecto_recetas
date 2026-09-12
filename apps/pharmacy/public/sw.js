/* ---------------------------------------------------------------------------
 * Minimal service worker: APP SHELL ONLY.
 *
 * HARD RULE (docs/17-diseno-y-experiencia.md):
 *
 *   The service worker caches the application shell, NEVER clinical content and
 *   NEVER verification responses. A cached verification would lie about the
 *   state of a prescription, which is exactly what this system exists to
 *   prevent.
 *
 * Concretely, everything below is forbidden in this file and must be rejected
 * in review:
 *   - caching any response from the API (/prescriptions/...), which carries
 *     ciphertext;
 *   - caching any JSON-RPC response from the chain (verify, getPrescription);
 *   - background sync or a replay queue that would re-send a dispense. Offline
 *     dispensing is an open decision (D-20), not an implemented behaviour, and
 *     no screen may promise it.
 *
 * Anything that is not a same-origin navigation or a precached shell asset is
 * passed straight to the network, untouched and uncached.
 * ------------------------------------------------------------------------- */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;

/** Shell assets only. No clinical data, no API responses. */
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET is ever considered. A dispense is a POST and must always hit the
  // network: it is an irreversible act.
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Cross-origin (API, RPC endpoint, bundler): never touched.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigations fall back to the cached shell when offline, so the app can at
  // least explain that it has no connectivity instead of showing a browser
  // error page. It never serves clinical content from the cache.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  // Precached shell assets only. Anything else goes to the network as-is.
  const isShellAsset = SHELL_ASSETS.includes(url.pathname);
  if (!isShellAsset) {
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
