// Local America service worker: app shell cached, data always fresh
const CACHE = 'local-america-v8';
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

  // Videos from Cloudflare R2: straight from the network (players need range requests, never cache them)
  if (url.hostname.endsWith('.r2.dev')) return;

  // Resized photos from Vercel: the browser's own cache handles these
  if (url.pathname.startsWith('/_vercel/')) return;

  // Never cache Meta pixel traffic: every tracking hit must reach Facebook
  if (url.hostname.endsWith('facebook.com') || url.hostname.endsWith('facebook.net')) return;

  // The private traffic, card maker, towns, pins and trails pages are never cached (and never saved in place of the guide)
  if (url.pathname.endsWith('/traffic.html') || url.pathname.endsWith('/traffic')) return;
  if (url.pathname.endsWith('/cards.html') || url.pathname.endsWith('/cards')) return;
  if (url.pathname.endsWith('/towns.html') || url.pathname.endsWith('/towns')) return;
  if (url.pathname.endsWith('/pins.html') || url.pathname.endsWith('/pins')) return;
  if (url.pathname.endsWith('/trails.html') || url.pathname.endsWith('/trails')) return;

  // Trails map tiles, aerial photos and topo lines (USGS): the browser's own cache handles these, so they don't pile up on the phone
  if (url.hostname === 'nationalmap.gov' || url.hostname.endsWith('.nationalmap.gov')) return;

  // The video list: always fresh, so new videos show up right away
  if (url.pathname === '/videos.json') return;

  // Google place pages, the page list and robots.txt: always fresh from the site, never saved in place of the guide
  if (url.pathname.startsWith('/places/') || url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') return;

  // Page loads: network first, fall back to the cached shell when offline.
  // Only the guide itself is saved as the offline copy.
  if (req.mode === 'navigate') {
    const isGuide = url.pathname === '/' || url.pathname === '/index.html';
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (isGuide && res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); }
          return res;
        })
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
