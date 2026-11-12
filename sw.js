// Local America service worker: app shell cached, data always fresh
const CACHE = 'local-america-v4';
const SHELL = ['./', './index.html', './manifest.json', './pixel.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache Supabase data, auth, or storage: always go to the network
  if (url.hostname.endsWith('supabase.co')) return;

  // Never cache Meta pixel traffic: every tracking hit must reach Facebook
  if (url.hostname.endsWith('facebook.com') || url.hostname.endsWith('facebook.net')) return;

  // The private traffic and card maker pages are never cached (and never saved in place of the guide)
  if (url.pathname.endsWith('/traffic.html') || url.pathname.endsWith('/traffic')) return;
  if (url.pathname.endsWith('/cards.html') || url.pathname.endsWith('/cards')) return;

  // Page loads: network first, fall back to the cached shell when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else (Tailwind, supabase-js, manifest): cache first, refresh in background
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
