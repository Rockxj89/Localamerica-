// Trails map "phone memory": keeps the map squares you've already looked at on the phone,
// so going back to a spot shows the photo and topo lines at once instead of downloading them again.
// It only runs for the private trails pages (its scope starts with /trails); the rest of the site keeps sw.js.
// It never touches sign-in, Supabase, payments, tracking or the place data: only public map pictures.
const TILES = 'trails-tiles-v1';
const MAX_TILES = 2500; // about 100 MB of squares at most; the oldest go first
const HOSTS = [
  'basemap.nationalmap.gov',        // satellite and plain map squares (USGS)
  'carto.nationalmap.gov',          // topo lines (USGS)
  'stateimagery.msdis.missouri.edu' // sharp Missouri photo (state of Missouri, MSDIS)
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('trails-tiles-') && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

let puts = 0;
async function trim() {
  const c = await caches.open(TILES);
  const keys = await c.keys(); // oldest first
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!HOSTS.includes(url.hostname)) return; // everything else goes straight to the network as usual

  event.respondWith((async () => {
    const c = await caches.open(TILES);
    const hit = await c.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    // Only keep good pictures that the page is allowed to read (no empty or error squares)
    if (res && res.ok && res.type === 'cors' && (res.headers.get('content-type') || '').startsWith('image/')) {
      const copy = res.clone();
      event.waitUntil(c.put(req, copy).then(() => { if (++puts % 50 === 0) return trim(); }).catch(() => {}));
    }
    return res;
  })());
});
