// Shared helpers for the Google place pages (/places/campsite-8) and the sitemap.
// Files starting with "_" are not their own web address on Vercel; they are only used by the others.
//
// SAFETY: places are read only from poi_public_locations, the public view that already blanks
// GPS for paid places. On top of that, toPlace() below throws away the coordinates of any place
// that isn't free, so paid GPS can never end up in a page, even if the view were changed one day.

const SITE = 'https://localamerica.us';
const SUPABASE_URL = 'https://ycdlxdijrlfsxvxksyrq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2ExdXbNtW9HpuOGAq1Oa7g_gPdONH_s'; // public key, same one the app uses
const PHOTO_BUCKET = 'poi-photos';

const toSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const isFreeAccess = (a) => String(a || '').toLowerCase() === 'free';

// Same names and short links as the app
const CATEGORY_LABELS = {
  'Buildings and stores': 'Buildings & stores', 'Dead end trails': 'Dead-end trails',
  'Established campsites': 'Campsites', 'Legends/lore': 'Legends & lore',
  'Mud holes/trails': 'Mud holes & trails', 'Rocks/Flex': 'Wheeling'
};
const catLabel = (c) => CATEGORY_LABELS[c] || c;
const CATEGORY_SLUGS = {
  'Buildings and stores': 'buildings', 'Dead end trails': 'dead-ends',
  'Established campsites': 'camp', 'Forgotten grounds': 'forgotten', 'Frog ponds': 'frogs',
  'Legends/lore': 'legends', 'Mud holes/trails': 'mud', 'Hiking Trails': 'hiking', 'Non-vehicle trails': 'hiking',
  'Popular locations': 'popular', 'Rappelling bluffs': 'bluffs', 'Wheeling': 'wheeling', 'Rocks/Flex': 'wheeling',
  'Scenic views': 'views', 'Swimming holes': 'swimming', 'Unmarked trails': 'unmarked',
  'Long Shot Fields': 'long-shot', 'Yardage fields': 'long-shot'
};
// Place types with their own short link (/camp) use it; any other type opens the app's list.
const catUrl = (c) => (CATEGORY_SLUGS[c] ? '/' + CATEGORY_SLUGS[c] : '/#/c/' + toSlug(c));

const CATEGORY_DESCRIPTIONS = {
  'Buildings and stores': 'Old buildings, shops, and structures',
  'Dead end trails': 'Trails that finish away from a through route',
  'Established campsites': 'Known places to set up camp',
  'Forgotten grounds': 'Overgrown or quiet places with a story',
  'Frog ponds': 'Small ponds and wetland spots',
  'Legends/lore': 'Places connected to local stories',
  'Mud holes/trails': 'Rough tracks and muddy routes',
  'Hiking Trails': 'Routes intended for walking',
  'Non-vehicle trails': 'Routes intended for walking',
  'Popular locations': 'Well-known places worth starting with',
  'Rappelling bluffs': 'Cliffs and rock faces for vertical routes',
  'Wheeling': 'Rocks to crawl and spots to play',
  'Rocks/Flex': 'Rocks to crawl and spots to play',
  'Scenic views': 'Lookouts and wide-open views',
  'Swimming holes': 'Creeks, pools, and water spots',
  'Unmarked trails': 'Routes without a formal trail marker',
  'Long Shot Fields': 'Open fields more than 300 yards across',
  'Yardage fields': 'Open fields more than 300 yards across'
};

function photoUrl(key) {
  if (!key) return '';
  if (/^https?:\/\//i.test(key)) return key;
  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
}
// Smaller copy made and cached by Vercel (same as the app)
const sizedUrl = (key, w) => `/_vercel/image?url=${encodeURIComponent(photoUrl(key))}&w=${w}&q=70`;

async function rest(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Database answered ${res.status}`);
  return res.json();
}

// Only the fields a page needs. Coordinates are kept for free places only.
function toPlace(row) {
  const free = isFreeAccess(row.access);
  const lat = free && row.latitude != null ? Number(row.latitude) : null;
  const lng = free && row.longitude != null ? Number(row.longitude) : null;
  return {
    id: row.id,
    name: String(row.name || ''),
    slug: toSlug(row.name),
    category: String(row.category || ''),
    description: String(row.description || ''),
    free,
    latitude: Number.isFinite(lat) && Number.isFinite(lng) ? lat : null,
    longitude: Number.isFinite(lat) && Number.isFinite(lng) ? lng : null
  };
}

// Kept for a minute while the server stays warm; Vercel also caches each page for 5 minutes.
let cache = null;
async function loadPlaces() {
  if (cache && Date.now() - cache.at < 60 * 1000) return cache.places;
  const rows = await rest('poi_public_locations?select=id,name,category,description,access,latitude,longitude&order=name&limit=1000');
  const places = (rows || []).map(toPlace).filter((p) => p.slug);
  cache = { at: Date.now(), places };
  return places;
}

async function loadPhotos(locationId) {
  const id = Number(locationId);
  if (!Number.isInteger(id)) return [];
  const rows = await rest(`poi_public_photos?select=object_key&location_id=eq.${id}&order=id&limit=50`);
  return (rows || []).map((r) => r.object_key).filter(Boolean);
}

const placeNum = (n) => { const m = /(\d+)\s*$/.exec(n || ''); return m ? +m[1] : Infinity; };
const byTypeThenNumber = (a, b) => a.category.localeCompare(b.category) || (placeNum(a.name) - placeNum(b.name)) || a.name.localeCompare(b.name);


// ---------- towns (for /near/<town> pages and photo labels) ----------
// Same town centers as the private Towns & Rivers page (towns.html).
const TOWNS = [
  ['Willow Springs', 36.9923, -91.9696, 'More places close to town than anywhere else in the app: mud holes, campsites and trails just minutes out of Willow Springs.'],
  ['Cabool', 37.1237, -92.1013, 'Campsites, trails and mud holes a short drive from Cabool, all in the Mark Twain National Forest.'],
  ['Mountain Grove', 37.1306, -92.2635, 'Dead end trails, campsites, swimming and bluffs within reach of Mountain Grove.'],
  ['Winona', 37.0092, -91.3229, 'Ponds and trails right outside Winona, some only a few miles from town.'],
  ['Eminence', 37.1506, -91.3576, 'Ponds and dead end trails close to Eminence, all on public land.'],
  ['West Plains', 36.7281, -91.8524, 'Trails, campsites, ponds and bluffs within 35 miles of West Plains.'],
  ['Gainesville', 36.6034, -92.4282, 'Campsites, ponds, swimming and bluffs near Gainesville, all on public land.'],
  ['Ava', 36.9520, -92.6605, 'Campsites, swimming holes, bluffs and mud holes within an easy drive of Ava, all on public land.'],
  ['Mountain View', 36.9953, -91.7035, 'Ponds, campsites and mud holes within reach of Mountain View.'],
  ['Mansfield', 37.1067, -92.5807, 'Hiking, campsites, bluffs and swimming a short drive from Mansfield.'],
  ['Hartville', 37.2506, -92.5102, 'Hiking trails, campsites and ponds within 35 miles of Hartville.'],
  ['Lebanon', 37.6806, -92.6638, 'Dead end trails, ponds and campsites within reach of Lebanon, in the Mark Twain National Forest.'],
  ['Forsyth', 36.6851, -93.1199, 'Campsites, mud holes, ponds and trails a short drive from Forsyth.'],
  ['Licking', 37.4995, -91.8571, 'Campsites, ponds and trails within 35 miles of Licking, all on public land.'],
  ['Houston', 37.3262, -91.9560, 'Campsites, trails and mud holes a short drive from Houston, Missouri.']
].map(([name, lat, lng, intro]) => ({ name, slug: toSlug(name), lat, lng, intro }));

const NEAR_MILES = 35;   // how far out a town page looks
const PER_TYPE = 3;      // closest places of each type on a town page

// SAFETY: distances are rounded to the nearest 5 miles (never below 5) before they leave the server,
// so the town pages can't be used to work out where a paid place is.
const roundMiles = (m) => Math.max(5, Math.round(Number(m) / 5) * 5);

// Roads in the Ozarks wind, so driving is longer than straight-line miles. Town pages show an estimate of
// driving miles: straight-line miles x 1.4 (owner decision, Nov 17). The 35-mile limit above uses these miles too.
const ROAD_FACTOR = 1.4;

// Miles from every town to every place: straight-line miles from the app's existing public
// poi_distances function (the same one Near me uses) x ROAD_FACTOR. Only whole-mile numbers come back, no coordinates.
// Paid places are measured to a hidden point 1 to 2 miles from the real spot, so their miles (and their
// nearest town) can be a little off on purpose (supabase/sql/2026-11-22-paid-distance-hidden-points.sql).
let distCache = null;
let distFailedAt = 0;
async function loadTownDistances() {
  if (distCache && Date.now() - distCache.at < 10 * 60 * 1000) return distCache.byTown;
  // After a failure, don't hammer the database: wait 30 seconds before trying again
  if (distFailedAt && Date.now() - distFailedAt < 30 * 1000) throw new Error('Distances recently failed');
  const byTown = {};
  try { await Promise.all(TOWNS.map(async (t) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/poi_distances`, {
      method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ user_lat: t.lat, user_lng: t.lng })
    });
    if (!res.ok) throw new Error(`Database answered ${res.status}`);
    const m = {};
    (await res.json() || []).forEach((r) => { if (r && r.miles != null && Number.isFinite(Number(r.miles))) m[r.id] = Number(r.miles) * ROAD_FACTOR; });
    byTown[t.slug] = m;
  })); } catch (e) { distFailedAt = Date.now(); throw e; }
  distCache = { at: Date.now(), byTown };
  return byTown;
}

// Closest town for each place: { placeId: { town, miles } } (miles already rounded)
async function loadNearestTowns() {
  const byTown = await loadTownDistances();
  const best = {};
  TOWNS.forEach((t) => {
    Object.entries(byTown[t.slug] || {}).forEach(([id, mi]) => {
      if (!best[id] || mi < best[id].raw) best[id] = { town: t.name, raw: mi };
    });
  });
  const out = {};
  Object.entries(best).forEach(([id, b]) => { out[id] = { town: b.town, miles: roundMiles(b.raw) }; });
  return out;
}

// All photos, grouped by place (one database call)
let photoCache = null;
async function loadAllPhotos() {
  if (photoCache && Date.now() - photoCache.at < 10 * 60 * 1000) return photoCache.byPlace;
  const rows = await rest('poi_public_photos?select=location_id,object_key&order=id&limit=5000');
  const byPlace = {};
  (rows || []).forEach((r) => { if (r && r.object_key) (byPlace[r.location_id] = byPlace[r.location_id] || []).push(r.object_key); });
  photoCache = { at: Date.now(), byPlace };
  return byPlace;
}

// One-of-a-kind name for each place type, for photo labels like "Swimming hole near Ava, Missouri"
const CATEGORY_SINGULAR = {
  'Buildings and stores': 'Old building', 'Open Stores': 'Store', 'Dead end trails': 'Dead-end trail',
  'Established campsites': 'Campsite', 'Forgotten grounds': 'Forgotten grounds spot', 'Frog ponds': 'Frog pond',
  'Legends/lore': 'Legends and lore spot', 'Mud holes/trails': 'Mud hole', 'Hiking Trails': 'Hiking trail',
  'Popular locations': 'Popular spot', 'Rappelling bluffs': 'Rappelling bluff', 'Wheeling': 'Wheeling spot', 'Rocks/Flex': 'Wheeling spot',
  'Scenic views': 'Scenic view', 'Swimming holes': 'Swimming hole', 'Unmarked trails': 'Unmarked trail',
  'Long Shot Fields': 'Long Shot field', 'Water crossings': 'Water crossing'
};
const catSingular = (c) => CATEGORY_SINGULAR[c] || catLabel(c);
const photoLabel = (p, town) => `${catSingular(p.category)} near ${town}, Missouri – Local America`;

module.exports = {
  SITE, toSlug, catLabel, catUrl, CATEGORY_DESCRIPTIONS, photoUrl, sizedUrl,
  loadPlaces, loadPhotos, byTypeThenNumber,
  TOWNS, NEAR_MILES, PER_TYPE, roundMiles, loadTownDistances, loadNearestTowns, loadAllPhotos, catSingular, photoLabel
};
