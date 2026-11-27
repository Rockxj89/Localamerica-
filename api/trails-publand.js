// Trails test map only (preview branch). Not used by the live app.
// Gets Missouri's public land outlines, trims them down, and lets Vercel keep a saved copy for a
// week, so phones load them from our own site instead of asking the sources each time.
// - National forest: Forest Service's own PAD-US layer (land the Forest Service owns)
// - Everything else (conservation areas, state parks, Corps of Engineers lakes, wildlife refuges,
//   Ozark National Scenic Riverways, city and county parks): USGS PAD-US 4.1 (public domain),
//   open or limited public access only, no private or nonprofit land, no easements.
const FS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_PADUS_01/MapServer/3/query';
const PADUS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Management_Areas/FeatureServer/0/query';
const FS_BOX = '-94.0,36.49,-89.5,38.8';
const SIMPLIFY = '&outSR=4326&maxAllowableOffset=0.0003&geometryPrecision=4';
// PAD-US's hosted layer drops the shape entirely when asked to simplify, so it comes in full
// and gets trimmed here instead.
const PAD_GEOM = '&outSR=4326&geometryPrecision=4';
const TOL = 0.0003;

function simplifyRing(pts) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let far = -1, best = TOL;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const trim = (rings) => rings.map(simplifyRing).filter((r) => r.length >= 4);
const PAD_WHERE = "State_Nm='MO' AND Pub_Access IN ('OA','RA') AND Own_Name NOT IN ('PVT','NGO','DESG')" +
  " AND Mang_Name NOT IN ('USFS','PVT','NGO','DOD') AND GIS_AcreD>=5";

async function getJson(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'LocalAmerica-trails-test' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'error');
      return j;
    } catch (e) { last = e; }
  }
  throw last;
}

async function pages(base, pageSize) {
  const out = [];
  for (let offset = 0; offset < 50000; offset += pageSize) {
    const j = await getJson(`${base}&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${pageSize}&f=json`);
    const feats = j.features || [];
    out.push(...feats);
    if (!j.exceededTransferLimit && feats.length < pageSize) break;
    if (!feats.length) break;
  }
  return out;
}

const title = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/'S\b/g, "'s").trim();

// What kind of public land it is, in plain words
function kind(a) {
  const d = a.Des_Tp, o = a.Own_Name, m = a.Mang_Name;
  if (d === 'SCA' || d === 'SREC' || d === 'SRMA' || d === 'REA' || o === 'SDC') return 'Conservation area';
  if (d === 'SP') return 'State park';
  if (d === 'SHCA') return 'State historic site';
  if (m === 'USACE' || o === 'USACE') return 'Corps of Engineers land';
  if (d === 'NWR' || o === 'FWS') return 'Wildlife refuge';
  if (o === 'NPS' || m === 'NPS') return 'National park land';
  if (o === 'CITY') return 'City park';
  if (o === 'CNTY') return 'County park';
  if (o === 'OTHS' || o === 'SLB' || o === 'SPR') return 'State land';
  return 'Public land';
}

module.exports = async (req, res) => {
  try {
    const [fs, pad] = await Promise.all([
      pages(`${FS}?where=1%3D1&geometry=${FS_BOX}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID&returnGeometry=true${SIMPLIFY}`, 200),
      pages(`${PADUS}?where=${encodeURIComponent(PAD_WHERE)}&outFields=Unit_Nm,Des_Tp,Own_Name,Mang_Name,Pub_Access&returnGeometry=true${PAD_GEOM}`, 500)
    ]);
    const areas = [];
    for (const f of fs) {
      const r = f.geometry && f.geometry.rings;
      if (r && r.length) areas.push({ k: 'National forest', n: r[0][0][0] < -89.6 ? 'Mark Twain National Forest' : '', o: 1, r });
    }
    for (const f of pad) {
      const r = f.geometry && f.geometry.rings && trim(f.geometry.rings);
      if (!r || !r.length) continue;
      const a = f.attributes || {};
      areas.push({ k: kind(a), n: title(a.Unit_Nm), o: a.Pub_Access === 'OA' ? 1 : 0, r });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // ?download=1 saves it as a file (for uploading to Cloudflare R2 by hand)
    if (req.query && req.query.download) res.setHeader('Content-Disposition', 'attachment; filename="public-land.json"');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000, stale-if-error=2592000');
    res.end(JSON.stringify({ saved: new Date().toISOString(), source: 'USGS PAD-US 4.1 and USDA Forest Service', areas }));
  } catch (e) {
    console.error(e);
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Public land map did not answer' }));
  }
};
