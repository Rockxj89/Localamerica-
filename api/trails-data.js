// Map data for the owner-only trails map (trails.html).
// Asks a few fixed public map services for one small square of Missouri and lets Vercel keep a
// saved copy, so the phone gets small answers from our own site. It only knows the sources listed
// below and only squares inside Missouri, so it can't be used to fetch anything else.
const CELL = 0.25; // same squares as the dirt road file
const MO = { x0: -384, x1: -356, y0: 143, y1: 163 }; // Missouri plus a little edge, in squares
const UA = { 'User-Agent': 'LocalAmerica-trails-map (localamerica.us)' };

async function getJson(url, opts = {}, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(opts.timeout || 25000), headers: UA, ...opts.fetch });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j && j.error) throw new Error((j.error && j.error.message) || 'error');
      return j;
    } catch (e) { last = e; }
  }
  throw last;
}

const r5 = (n) => Math.round(n * 1e5) / 1e5;
const keep = (o, names) => { const a = {}; for (const k of names) { const v = o && o[k]; if (v != null && String(v).trim() !== '') a[k] = v; } return a; };

// ---------- Forest Service trails (hiking, horse and bike), Mark Twain National Forest ----------
const FS_TRAILS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query';
const FS_TRAIL_FIELDS = ['trail_name', 'trail_no', 'trail_class', 'trail_type', 'trail_surface', 'typical_trail_grade', 'typical_tread_width', 'gis_miles',
  'terra_motorized', 'hiker_pedestrian_managed', 'hiker_pedestrian_accpt', 'pack_saddle_managed', 'pack_saddle_accpt',
  'bicycle_managed', 'bicycle_accpt', 'motorcycle_managed', 'motorcycle_accpt', 'atv_managed', 'atv_accpt', 'fourwd_managed', 'fourwd_accpt'];
async function fsTrails([w, s, e, n]) {
  const out = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const q = new URLSearchParams({
      where: "trail_type='TERRA'", geometry: `${w},${s},${e},${n}`, geometryType: 'esriGeometryEnvelope', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: FS_TRAIL_FIELDS.join(','), returnGeometry: 'true', outSR: '4326',
      maxAllowableOffset: '0.00003', geometryPrecision: '5', orderByFields: 'objectid', resultOffset: String(offset), resultRecordCount: '1000', f: 'json'
    });
    const j = await getJson(`${FS_TRAILS}?${q}`);
    const feats = j.features || [];
    for (const f of feats) {
      const p = (f.geometry && f.geometry.paths) || [];
      if (p.length) out.push({ a: keep(f.attributes, FS_TRAIL_FIELDS), p });
    }
    if (!j.exceededTransferLimit || !feats.length) break;
  }
  return { features: out };
}

const SOURCES = {
  fstrails: { run: fsTrails, days: 7 },
};

module.exports = async (req, res) => {
  const q = req.query || {};
  const src = SOURCES[q.src];
  const x = Number(q.x), y = Number(q.y);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!src || !Number.isInteger(x) || !Number.isInteger(y) || x < MO.x0 || x > MO.x1 || y < MO.y0 || y > MO.y1) {
    res.statusCode = 400;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: 'unknown map data' }));
  }
  try {
    const box = [x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL];
    const data = await src.run(box);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('CDN-Cache-Control', `public, s-maxage=${src.days * 86400}, stale-while-revalidate=2592000, stale-if-error=2592000`);
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error(q.src, x, y, e && e.message);
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'map service did not answer' }));
  }
};
