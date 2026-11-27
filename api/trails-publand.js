// Trails test map only (preview branch). Not used by the live app.
// Gets the public land the Forest Service owns in Missouri (Mark Twain National Forest, from the
// free PAD-US data the Forest Service publishes), trims the outlines down, and lets Vercel keep a
// saved copy for a week, so phones load it from our own site instead of asking the Forest Service.
const SRC = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_PADUS_01/MapServer/3/query';
// Covers the Mark Twain National Forest in Missouri
const BOX = '-94.0,36.49,-89.5,38.8';
const PAGE = 200;

async function getJson(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'LocalAmerica-trails-test' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'error');
      return j;
    } catch (e) { last = e; }
  }
  throw last;
}

module.exports = async (req, res) => {
  try {
    const out = [];
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const url = `${SRC}?where=1%3D1&geometry=${BOX}&geometryType=esriGeometryEnvelope&inSR=4326` +
        `&spatialRel=esriSpatialRelIntersects&outFields=objectid&returnGeometry=true&outSR=4326` +
        `&maxAllowableOffset=0.0002&geometryPrecision=4&orderByFields=objectid` +
        `&resultOffset=${offset}&resultRecordCount=${PAGE}&f=json`;
      const j = await getJson(url);
      const feats = j.features || [];
      for (const f of feats) {
        const rings = (f.geometry && f.geometry.rings) || [];
        if (rings.length) out.push(rings);
      }
      if (!j.exceededTransferLimit && feats.length < PAGE) break;
      if (!feats.length) break;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000, stale-if-error=2592000');
    res.end(JSON.stringify({ saved: new Date().toISOString(), source: 'USDA Forest Service, PAD-US surface ownership', areas: out }));
  } catch (e) {
    console.error(e);
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Forest Service map did not answer' }));
  }
};
