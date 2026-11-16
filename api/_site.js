// Shared helpers for the Google place pages (/places/cave-4) and the sitemap.
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
  'Mud holes/trails': 'Mud holes & trails', 'Rocks/Flex': 'Rocks & flex'
};
const catLabel = (c) => CATEGORY_LABELS[c] || c;
const CATEGORY_SLUGS = {
  'Buildings and stores': 'buildings', 'Caves': 'caves', 'Dead end trails': 'dead-ends',
  'Established campsites': 'camp', 'Forgotten grounds': 'forgotten', 'Frog ponds': 'frogs',
  'Legends/lore': 'legends', 'Mud holes/trails': 'mud', 'Hiking Trails': 'hiking', 'Non-vehicle trails': 'hiking',
  'Popular locations': 'popular', 'Rappelling bluffs': 'bluffs', 'Rocks/Flex': 'rocks',
  'Scenic views': 'views', 'Swimming holes': 'swimming', 'Unmarked trails': 'unmarked',
  'Long Shot Fields': 'long-shot', 'Yardage fields': 'long-shot'
};
// Place types with their own short link (/caves) use it; any other type opens the app's list.
const catUrl = (c) => (CATEGORY_SLUGS[c] ? '/' + CATEGORY_SLUGS[c] : '/#/c/' + toSlug(c));

const CATEGORY_DESCRIPTIONS = {
  'Buildings and stores': 'Old buildings, shops, and structures',
  'Caves': 'Caverns, overhangs, and tucked-away openings',
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
  'Rocks/Flex': 'Rock formations and flexible-use spots',
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

module.exports = {
  SITE, toSlug, catLabel, catUrl, CATEGORY_DESCRIPTIONS, photoUrl, sizedUrl,
  loadPlaces, loadPhotos, byTypeThenNumber
};
