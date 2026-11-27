// Map data for the owner-only trails map (trails.html): trails by square, and a few live layers for the whole state.
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

// ---------- Live: road closures from MoDOT (all of Missouri) ----------
// Only the public road facts are kept; the service also lists staff names and phone numbers, which are dropped here.
const MODOT = 'https://mapping.modot.org/arcgis/rest/services/TravelerInformation/TravelerInformationData/MapServer';
const MODOT_EVENT = ['TRAVELWAY_NAME', 'DESIGNATION', 'DIRECTION', 'COUNTY_NAME', 'TYPE_CODE', 'LEVEL_OF_IMPACT_CODE', 'EXT_COMMENT', 'BEGIN_DESCRIPTION', 'END_DESCRIPTION', 'START_DATE', 'END_DATE', 'RIVER_NAME'];
const MODOT_WORK = ['TRAVELWAY_NAME', 'DESIGNATION', 'DIRECTION', 'COUNTY_NAME', 'WORK_TYPE', 'LEVEL_OF_IMPACT', 'BEG_REF_PT', 'END_REF_PT', 'START_DATE', 'END_DATE', 'START_TIME', 'END_TIME'];
// Layers 21, 22 and 23 are MoDOT's "Closed Point" layers (only full closures); the flood layer holds every flood note, so it is filtered to CLOSED.
const CLOSURE_LAYERS = [
  { id: 21, kind: 'crash', fields: MODOT_EVENT },
  { id: 23, kind: 'winter', fields: MODOT_EVENT },
  { id: 0, kind: 'flood', fields: MODOT_EVENT, where: "LEVEL_OF_IMPACT_CODE='CLOSED'" },
  { id: 22, kind: 'work', fields: MODOT_WORK },
];
async function closures() {
  const out = [];
  // one MoDOT layer failing shouldn't blank the others; only fail if none answered
  const got = await Promise.allSettled(CLOSURE_LAYERS.map(async (L) => {
    const q = new URLSearchParams({ where: L.where || '1=1', outFields: L.fields.join(','), returnGeometry: 'true', outSR: '4326', resultRecordCount: '2000', f: 'json' });
    const j = await getJson(`${MODOT}/${L.id}/query?${q}`, { timeout: 15000 });
    for (const f of j.features || []) {
      const g = f.geometry;
      if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
      const a = keep(f.attributes, L.fields);
      for (const k of Object.keys(a)) { if (typeof a[k] === 'string') a[k] = a[k].trim().slice(0, 400); if (a[k] === '') delete a[k]; }
      out.push({ k: L.kind, a, p: [r5(g.y), r5(g.x)] });
    }
    if (j.exceededTransferLimit) console.error('closures: more than 2000 in layer', L.id);
  }));
  if (got.every((r) => r.status === 'rejected')) throw got[0].reason;
  return { at: Date.now(), closures: out };
}

// ---------- Live: wildfires from NIFC (Missouri and a little around it) ----------
const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services';
const FIRE_BOX = '-96.5,35.3,-88.3,41.3';
async function fires() {
  const box = { geometry: FIRE_BOX, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outSR: '4326', f: 'json' };
  const [pts, polys] = await Promise.all([
    getJson(`${WFIGS}/WFIGS_Incident_Locations_Current/FeatureServer/0/query?${new URLSearchParams({ ...box, where: "IncidentTypeCategory='WF'", outFields: 'IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt', returnGeometry: 'true', resultRecordCount: '1000' })}`, { timeout: 15000 }),
    getJson(`${WFIGS}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?${new URLSearchParams({ ...box, where: '1=1', outFields: 'poly_IncidentName,poly_GISAcres,attr_PercentContained', returnGeometry: 'true', maxAllowableOffset: '0.0005', geometryPrecision: '4', resultRecordCount: '500' })}`, { timeout: 15000 }),
  ]);
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    at: Date.now(),
    fires: (pts.features || []).filter((f) => f.geometry && Number.isFinite(f.geometry.x)).map((f) => ({
      n: String(f.attributes.IncidentName || '').slice(0, 80), ac: num(f.attributes.IncidentSize), pc: num(f.attributes.PercentContained),
      d: num(f.attributes.FireDiscoveryDateTime), u: num(f.attributes.ModifiedOnDateTime_dt), p: [r5(f.geometry.y), r5(f.geometry.x)],
    })),
    areas: (polys.features || []).filter((f) => f.geometry && f.geometry.rings).map((f) => ({
      n: String(f.attributes.poly_IncidentName || '').slice(0, 80), ac: num(f.attributes.poly_GISAcres), pc: num(f.attributes.attr_PercentContained), r: f.geometry.rings,
    })),
  };
}

// ---------- Live: river levels from USGS stream gauges (Missouri) ----------
async function rivers() {
  const q = new URLSearchParams({ format: 'json', stateCd: 'mo', parameterCd: '00060,00065', siteStatus: 'active', siteType: 'ST' });
  const j = await getJson(`https://waterservices.usgs.gov/nwis/iv/?${q}`, { timeout: 20000 });
  const by = new Map();
  for (const t of (j.value && j.value.timeSeries) || []) {
    const si = t.sourceInfo || {}, code = si.siteCode && si.siteCode[0] && si.siteCode[0].value;
    const geo = si.geoLocation && si.geoLocation.geogLocation;
    if (!code || !/^\d{8,15}$/.test(code) || !geo || !Number.isFinite(Number(geo.latitude)) || !Number.isFinite(Number(geo.longitude))) continue;
    const v = t.values && t.values[0] && t.values[0].value && t.values[0].value[0];
    const param = t.variable && t.variable.variableCode && t.variable.variableCode[0] && t.variable.variableCode[0].value;
    const nd = t.variable && t.variable.noDataValue;
    if (!by.has(code)) by.set(code, { id: code, n: String(si.siteName || '').slice(0, 100), p: [r5(Number(geo.latitude)), r5(Number(geo.longitude))] });
    if (!v || Number(v.value) === nd || !Number.isFinite(Number(v.value))) continue;
    const g = by.get(code);
    if (param === '00065') { g.ft = Number(v.value); g.t = Date.parse(v.dateTime) || null; }
    if (param === '00060') { g.cfs = Number(v.value); g.t = g.t || Date.parse(v.dateTime) || null; }
  }
  return { at: Date.now(), gauges: [...by.values()].filter((g) => g.ft != null || g.cfs != null) };
}

// ---------- Forest camping spots, Mark Twain National Forest ----------
// Forest Service recreation list: dispersed camping spots and campgrounds. Changes rarely, so kept a day.
const FS_REC = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query';
async function camping() {
  const q = new URLSearchParams({
    where: "forestorgcode='0905' AND markeractivity IN ('Dispersed Camping','Campground Camping')",
    outFields: 'recareaname,latitude,longitude,openstatus,recareaurl,markeractivity,recareaid', returnGeometry: 'false', resultRecordCount: '1000', f: 'json'
  });
  const j = await getJson(`${FS_REC}?${q}`, { timeout: 20000 });
  const seen = new Set(), out = [];
  for (const f of j.features || []) {
    const a = f.attributes || {}, lat = Number(a.latitude), lng = Number(a.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 35.9 || lat > 40.7 || lng < -95.8 || lng > -89) continue;
    const key = (a.recareaid || (a.recareaname + '@' + r5(lat) + ',' + r5(lng))) + '|' + a.markeractivity;
    if (seen.has(key)) continue; seen.add(key);
    const url = typeof a.recareaurl === 'string' && /^https:\/\/www\.fs\.usda\.gov\/[\w\/?=&.-]*$/.test(a.recareaurl) ? a.recareaurl : null;
    out.push({ n: String(a.recareaname || '').slice(0, 100), k: a.markeractivity === 'Dispersed Camping' ? 'dispersed' : 'campground',
      closed: String(a.openstatus || '').toLowerCase() === 'closed', u: url, p: [r5(lat), r5(lng)] });
  }
  if (!out.length) throw new Error('camping: no spots');
  return { at: Date.now(), spots: out };
}

const SOURCES = {
  fstrails: { run: fsTrails, days: 7 },
  // live sources cover the whole state at once (no squares) and are only kept a few minutes
  closures: { run: closures, whole: true, minutes: 10 },
  fires: { run: fires, whole: true, minutes: 15 },
  rivers: { run: rivers, whole: true, minutes: 15 },
  camping: { run: camping, whole: true, minutes: 1440 },
};

module.exports = async (req, res) => {
  const q = req.query || {};
  const src = typeof q.src === 'string' && Object.prototype.hasOwnProperty.call(SOURCES, q.src) ? SOURCES[q.src] : null;
  const INT = /^-?\d{1,4}$/;
  const x = typeof q.x === 'string' && INT.test(q.x) ? Number(q.x) : NaN, y = typeof q.y === 'string' && INT.test(q.y) ? Number(q.y) : NaN;
  const allowed = src && src.whole ? ['src'] : ['src', 'x', 'y'];
  const extra = Object.keys(q).some((k) => !allowed.includes(k));
  const badSquare = !src || src.whole ? false : (!Number.isInteger(x) || !Number.isInteger(y) || x < MO.x0 || x > MO.x1 || y < MO.y0 || y > MO.y1);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!src || extra || badSquare) {
    res.statusCode = 400;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: 'unknown map data' }));
  }
  try {
    const data = src.whole ? await src.run() : await src.run([x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL]);
    if (src.whole) {
      const sec = src.minutes * 60;
      res.setHeader('Cache-Control', `public, max-age=${Math.min(sec, 300)}`);
      res.setHeader('CDN-Cache-Control', `public, s-maxage=${sec}, stale-while-revalidate=${sec}, stale-if-error=3600`);
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('CDN-Cache-Control', `public, s-maxage=${src.days * 86400}, stale-while-revalidate=2592000, stale-if-error=2592000`);
    }
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error(q.src, x, y, e && e.message);
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'map service did not answer' }));
  }
};
