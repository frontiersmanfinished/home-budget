// Keeps the app and the Firebase code on the phone so it opens with no signal.
// Bump VERSION with each release. A new version waits until the app asks it to take over.
const VERSION = 'v5';
const APP_CACHE = `home-budget-${VERSION}`;
const SDK_CACHE = 'home-budget-sdk-12.18.0';
const SDK = ['app', 'auth', 'firestore'].map(n => `https://www.gstatic.com/firebasejs/12.18.0/firebase-${n}.js`);
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/main.js', 'js/engine.js', 'js/ynab.js', 'js/search.js', 'js/store.js', 'js/backend.js', 'js/backend-local.js', 'js/firebase-config.js', 'js/ui.js', 'js/views.js', 'js/sheets.js', 'js/pages.js', 'js/icons.js', 'fonts/poppins-400.woff', 'fonts/poppins-500.woff', 'fonts/poppins-700.woff', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/shortcut-add.png', 'icons/shortcut-afford.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    await (await caches.open(APP_CACHE)).addAll(FILES.map(f => new Request(f, { cache: 'reload' })));
    const sdk = await caches.open(SDK_CACHE);
    await Promise.all(SDK.map(u => sdk.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    // The first install takes over straight away; later versions wait to be asked.
    if (!(await self.clients.matchAll()).length) await self.skipWaiting();
  })());
});
self.addEventListener('message', e => { if (e.data === 'activate') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== APP_CACHE && k !== SDK_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.href.startsWith('https://www.gstatic.com/firebasejs/')) {
    e.respondWith(caches.open(SDK_CACHE).then(async c => (await c.match(r.url)) || fetch(r).then(res => { if (res.ok) c.put(r.url, res.clone()); return res; })));
  } else if (u.origin === location.origin) {
    // Serve this version's files from the phone; a new version arrives through the update prompt.
    e.respondWith((async () => {
      const c = await caches.open(APP_CACHE), key = r.mode === 'navigate' ? 'index.html' : u.pathname.endsWith('/') ? './' : r;
      return (await c.match(key, { ignoreSearch: true })) || fetch(r);
    })());
  }
});
