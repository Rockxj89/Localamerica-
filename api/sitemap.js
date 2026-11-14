// Page list for Google: localamerica.us/sitemap.xml
// Built from the database, so new places are added (and removed places dropped) by themselves.
const S = require('./_site');

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
  const urls = [S.SITE + '/', ...places.map((p) => `${S.SITE}/places/${p.slug}`)];
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${xmlEsc(u)}</loc></url>`).join('\n') + '\n</urlset>\n';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.end(xml);
};
