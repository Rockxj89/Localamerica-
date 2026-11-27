// Trails test map only (preview branch). Not used by the live app.
// Gets the Forest Service roads and trails open to vehicles (Motor Vehicle Use Map) for the
// Mark Twain National Forest in one go, trims them down, and lets Vercel keep a saved copy for a
// week, so phones load them from our own site instead of asking the Forest Service each time.
const MVUM = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer/';
// Covers the Mark Twain National Forest in Missouri
const BOX = '-94.0,36.49,-89.5,38.8';
const KEEP = ['name', 'id', 'gis_miles', 'seasonal', 'operationalmaintlevel',
  'passengervehicle', 'passengervehicle_datesopen', 'highclearancevehicle', 'highclearancevehicle_datesopen',
  'fourwd_gt50inches', 'fourwd_gt50_datesopen', 'atv', 'atv_datesopen',
  'otherwheeled_ohv', 'otherwheeled_ohv_datesopen', 'motorcycle', 'motorcycle_datesopen'];
const PAGE = 1000;

async function getJson(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'LocalAmerica-trails-test' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'error');
      return j;
    } catch (e) { last = e; }
  }
  throw last;
}

async function layer(id) {
  const out = [];
  for (let offset = 0; offset < 50000; offset += PAGE) {
    const url = `${MVUM}${id}/query?where=1%3D1&geometry=${BOX}&geometryType=esriGeometryEnvelope&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.00005` +
      `&geometryPrecision=5&orderByFields=objectid&resultOffset=${offset}&resultRecordCount=${PAGE}&f=json`;
    const j = await getJson(url);
    const feats = j.features || [];
    for (const f of feats) {
      const a = {};
      for (const k of KEEP) {
        const v = f.attributes && f.attributes[k];
        if (v != null && String(v).trim() !== '') a[k] = v;
      }
      const p = (f.geometry && f.geometry.paths) || [];
      if (p.length) out.push({ t: id, a, p });
    }
    if (!j.exceededTransferLimit && feats.length < PAGE) break;
    if (!feats.length) break;
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    const [roads, trails] = await Promise.all([layer(1), layer(2)]);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Saved copy on Vercel for a week; an old copy keeps being used for up to 30 more days if the Forest Service is down
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000, stale-if-error=2592000');
    res.end(JSON.stringify({ saved: new Date().toISOString(), source: 'USDA Forest Service Motor Vehicle Use Map', features: roads.concat(trails) }));
  } catch (e) {
    console.error(e);
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Forest Service map did not answer' }));
  }
};
