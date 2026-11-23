// Shared bits for the tests. Only public values: the key is the same publishable key the app uses.
const SUPABASE_URL = 'https://ycdlxdijrlfsxvxksyrq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2ExdXbNtW9HpuOGAq1Oa7g_gPdONH_s';
const CHECKOUT_URL = SUPABASE_URL + '/functions/v1/checkout';
const LIVE_URL = 'https://localamerica.us';

// Ava's town center (public, it's in api/_site.js). Used as "where the phone is" for Near me.
const AVA = { latitude: 36.952, longitude: -92.6605 };
// Owner's rule: Near me inside a place type shows only the closest 5, within 75 straight-line miles.
const NEAR_COUNT = 5;
const NEAR_MILES = 75;
const PRICE = '$4.99';

// Owner's rule (Nov 21 and Nov 23, 2026): no caves in the app, not as places and not in the wording
// ("caving" added Nov 23, when it came out of Safety & Terms section 2).
const CAVE_WORD = /\bcav(e|es|ern|erns|ing)\b/i;

// Numbers that look like GPS in Missouri: a latitude like 36.952 or a longitude like -92.6605 or 92.6605
// (3 or more decimals). Every one found on a public page must be a FREE place's GPS.
const LAT_RE = /(?<![\d.])(?:3[5-9]|40)\.\d{3,}/g;
const LNG_RE = /(?<![\d.])-?\s?(?:8[89]|9[0-6])\.\d{3,}/g;

const toSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const isFree = (p) => String(p.access || '').toLowerCase() === 'free';

// GPS-looking numbers on a page that don't belong to any free place (should always be empty)
// (A number shown with fewer decimals still matches the free place it was rounded from.)
function strayCoordinates(text, freePlaces) {
  const lats = freePlaces.map((p) => Math.abs(Number(p.latitude)));
  const lngs = freePlaces.map((p) => Math.abs(Number(p.longitude)));
  const near = (list, raw) => {
    const v = Math.abs(Number(raw.replace(/\s/g, '')));
    const tol = 0.5 * 10 ** -raw.split('.')[1].length + 1e-9;
    return list.some((x) => Math.abs(x - v) <= tol);
  };
  const out = [];
  for (const m of String(text).matchAll(LAT_RE)) if (!near(lats, m[0])) out.push(m[0]);
  for (const m of String(text).matchAll(LNG_RE)) if (!near(lngs, m[0])) out.push(m[0]);
  return out;
}
// Any GPS-looking number at all (town pages and the page list should have none)
function hasAnyCoordinates(text) {
  const s = String(text);
  return [...s.matchAll(LAT_RE)].length > 0 || [...s.matchAll(LNG_RE)].length > 0;
}

// Straight-line miles, same formula as the database
function milesBetween(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' };

// Read-only calls to the live public data, the same ones anyone visiting the app makes
async function rest(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Database answered ${res.status} for ${pathAndQuery.split('?')[0]}`);
  return res.json();
}
const publicPlaces = () => rest('poi_public_locations?select=id,name,category,access,latitude,longitude,description&limit=2000');

async function distancesFrom(spot) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/poi_distances`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_lat: spot.latitude, user_lng: spot.longitude })
  });
  if (!res.ok) throw new Error(`Distances answered ${res.status}`);
  return res.json();
}

// A random browser token like the app makes (never used to buy anything)
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

module.exports = {
  SUPABASE_URL, SUPABASE_KEY, CHECKOUT_URL, LIVE_URL, AVA, NEAR_COUNT, NEAR_MILES, PRICE, CAVE_WORD,
  toSlug, isFree, strayCoordinates, hasAnyCoordinates, milesBetween, rest, publicPlaces, distancesFrom, randomToken
};
