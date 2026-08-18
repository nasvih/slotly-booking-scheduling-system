/* Service worker — offline shell for the demo apps.
   Cache-first for the app's own files, network-first for nothing (there is no
   network), and a single versioned cache so an update wipes the old one.
   Bump CACHE_VERSION whenever the file list or any cached asset changes. */

const CACHE_VERSION = 'v14';
const CACHE = `${self.registration.scope}::${CACHE_VERSION}`;

/* slotly's own files. Every one of these must exist: a single 404 fails the
   whole addAll and the app is then not installable offline. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',

  './assets/app.css',
  './assets/slotly.css',

  './lib/ui.js',
  './lib/assistant.js',
  './lib/pwa.js',
  './lib/i18n.js',

  './src/main.js',
  './src/strings.js',
  './src/data.js',
  './src/agent.js',
  './src/actions.js',
  './src/parse.js',
  './src/booking.js',
  './src/token.js',
  './src/notify.js',
  './src/chrome.js',
  './src/drawer.js',
  './src/views/book.js',
  './src/views/today.js',
  './src/views/calendar.js',
  './src/views/bookings.js',
  './src/views/services.js',
  './src/views/staff.js',
  './src/views/customers.js',
  './src/views/settings.js',

  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith(self.registration.scope)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  /* Navigations: serve the shell so a reload works with no connection. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { cachePut(req, res.clone()); return res; })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  /* Same-origin assets: cache first, then network, then whatever we have. */
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { cachePut(req, res.clone()); return res; })),
    );
    return;
  }

  /* Cross-origin (the font stylesheet only): network, fall back to cache. */
  event.respondWith(
    fetch(req).then((res) => { cachePut(req, res.clone()); return res; }).catch(() => caches.match(req)),
  );
});

function cachePut(req, res) {
  if (!res || res.status !== 200 || (res.type !== 'basic' && res.type !== 'cors')) return;
  caches.open(CACHE).then((c) => c.put(req, res)).catch(() => {});
}
