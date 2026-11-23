// Page list for Google: localamerica.us/sitemap.xml
// Built from the database, so new places are added (and removed places dropped) by themselves.
const S = require('./_site');

// IndexNow (Bing and others): the key file at the site root proves the site is ours.
const INDEXNOW_KEY = 'eefc95dd7bc1b14253184b783f6a4f75';

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

module.exports = async (req, res) => {
  let places;
  try {
    places = (await S.loadPlaces()).slice().sort(S.byTypeThenNumber);
  } catch (e) {
    console.error(e);
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    return res.end('Sitemap is not available right now.');
  }
  // Photos are listed too (image sitemap), so they can show up in Google Images. Failing to load them
  // never breaks the page list.
  let photos = {};
  try { photos = await S.loadAllPhotos(); } catch (e) { console.error(e); }
  // Photo links point at the smaller copies Vercel already makes and caches, not the Supabase originals.
  const img = (k) => `  <image:image><image:loc>${xmlEsc(S.SITE + S.sizedUrl(k, 1080))}</image:loc></image:image>`;
  const entries = [
    { loc: S.SITE + '/' },
    ...S.TOWNS.map((t) => ({ loc: `${S.SITE}/near/${t.slug}` })),
    ...places.map((p) => ({ loc: `${S.SITE}/places/${p.slug}`, images: (photos[p.id] || []).slice(0, 5) }))
  ];
  // ?format=indexnow returns the same page list as a ready-to-send IndexNow message (used by the weekly timer, api/indexnow.js).
  if (req.query && req.query.format === 'indexnow') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    return res.end(JSON.stringify({
      host: new URL(S.SITE).host,
      key: INDEXNOW_KEY,
      keyLocation: `${S.SITE}/${INDEXNOW_KEY}.txt`,
      urlList: entries.map((e) => e.loc)
    }));
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    entries.map((e) => `  <url><loc>${xmlEsc(e.loc)}</loc>${(e.images || []).length ? '\n' + e.images.map(img).join('\n') + '\n  ' : ''}</url>`).join('\n') + '\n</urlset>\n';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.end(xml);
};
