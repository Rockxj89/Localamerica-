// Checks of the live site and its public data, run after every merge and every day.
// Read only: it asks the live checkout only questions that are refused before Stripe is ever contacted,
// and it never starts a checkout for a paid place. Plain page loads run no scripts, so nothing is counted.
// Run from the repo root: node --test "tests/live/*.test.js"   (LIVE_URL to point it somewhere else)
// The run log is public, so failure messages never print coordinates or name a readable private table
// (set LA_VERBOSE=1 on a private run to see names).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/site');

const BASE = (process.env.LIVE_URL || S.LIVE_URL).replace(/\/$/, '');
const ROOT = path.join(__dirname, '..', '..');

// Network hiccups get two more tries; real answers (even errors) don't
async function get(url, opts = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...opts });
      if (res.status >= 500 && i < 2) throw new Error('server answered ' + res.status);
      return res;
    } catch (e) {
      if (i >= 2) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}
const checkout = (body) => get(S.CHECKOUT_URL, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: S.SUPABASE_KEY }, body: JSON.stringify(body)
});
async function inBatches(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(...await Promise.all(list.slice(i, i + size).map(fn)));
  return out;
}

let places, freePlaces;
test.before(async () => {
  places = await S.publicPlaces();
  freePlaces = places.filter(S.isFree);
});

test('the live site is running the latest code', async () => {
  const live = await (await get(`${BASE}/index.html`)).text();
  const here = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
  assert.equal(hash(live), hash(here), 'localamerica.us is not serving the index.html on main (a failed deploy or a rollback?)');
});

test('public data: paid places have no GPS, free places do', () => {
  assert.ok(places.length >= 100, `only ${places.length} places came back`);
  for (const p of places) {
    if (S.isFree(p)) {
      assert.ok(p.latitude > 35 && p.latitude < 41 && p.longitude > -96 && p.longitude < -88, `${p.name} (free) has no usable GPS`);
    } else {
      assert.ok(p.latitude == null && p.longitude == null, `${p.name} (paid) shows GPS publicly`);
    }
  }
});

test('no cave places and no cave words in the public data', () => {
  for (const p of places) {
    assert.ok(!S.CAVE_WORD.test(`${p.name} ${p.category} ${p.description || ''}`), `${p.name} mentions caves`);
  }
});

test("the public can't read private tables or use owner tools", async () => {
  const tables = ['poi_locations', 'poi_location_photos', 'poi_customer_access', 'poi_pin_inbox', 'poi_traffic_events',
    'poi_card_maker_cards', 'poi_admins', 'poi_owner_browsers', 'post_images', 'post_image_tokens', 'post_image_settings'];
  const open = [];
  for (const t of tables) {
    const res = await get(`${S.SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: S.SUPABASE_KEY, Authorization: `Bearer ${S.SUPABASE_KEY}` } });
    const body = await res.text();
    if (!(res.status >= 400 || body.trim() === '[]')) open.push(t);
  }
  for (const fn of ['owner_place_coords', 'traffic_summary', 'card_maker_cards', 'backup_structure', 'mint_post_image_token', 'poi_delete_old_traffic']) {
    const res = await get(`${S.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: S.SUPABASE_KEY, Authorization: `Bearer ${S.SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: '{}'
    });
    if (res.status < 400) open.push(fn);
  }
  assert.ok(open.length === 0, `${open.length} private table(s) or owner tool(s) are open to the public` + (process.env.LA_VERBOSE ? ': ' + open.join(', ') : ''));
});

test('distances: every live place, and free places measured to their real spot', async () => {
  const rows = await S.distancesFrom(S.AVA);
  const ids = new Set(rows.map((r) => r.id));
  for (const p of places) assert.ok(ids.has(p.id), `no distance for ${p.name}`);
  for (const r of rows) assert.ok(Number.isFinite(Number(r.miles)) && Number(r.miles) >= 0, 'bad miles');
  const miles = Object.fromEntries(rows.map((r) => [r.id, Number(r.miles)]));
  for (const p of freePlaces) {
    const real = S.milesBetween(S.AVA, p);
    assert.ok(Math.abs(miles[p.id] - real) <= 1, `${p.name}: ${miles[p.id]} mi, real ${real.toFixed(1)}`);
  }
});

test('checkout refuses what it should, and never opens a Stripe checkout here', async () => {
  const t = S.randomToken();
  let res = await checkout({ action: 'unlocked', token: t });
  assert.equal(res.status, 200);
  const got = (await res.json()).places || [];
  assert.ok(got.length === 0, `a brand-new browser got ${got.length} unlocked place(s)`);
  const freeOne = freePlaces[0];
  res = await checkout({ action: 'start', token: t, locationId: freeOne.id, returnUrl: S.LIVE_URL + '/' });
  assert.equal(res.status, 400, 'a free place could be sold');
  res = await checkout({ action: 'start', token: t, locationId: 999999, returnUrl: S.LIVE_URL + '/' });
  assert.equal(res.status, 404, 'a place that does not exist could be sold');
  res = await checkout({ action: 'start', token: 'not-a-token', locationId: freeOne.id });
  assert.equal(res.status, 400);
  res = await checkout({ action: 'complete', token: t, sessionId: 'cs_live_' + S.randomToken().slice(0, 24) });
  assert.equal(res.status, 403, 'a made-up checkout was accepted');
  res = await checkout({ action: 'complete', token: t, sessionId: 'nope' });
  assert.equal(res.status, 400);
  res = await get(S.CHECKOUT_URL, { method: 'GET', headers: { apikey: S.SUPABASE_KEY } });
  assert.ok(res.status >= 400, 'checkout answered a GET');
});

test('every live page: no paid GPS and no caves', async () => {
  const sitemap = await (await get(`${BASE}/sitemap.xml`)).text();
  assert.ok(!S.hasAnyCoordinates(sitemap), 'the page list has coordinates');
  assert.ok(!S.CAVE_WORD.test(sitemap), 'the page list mentions caves');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => !u.includes('/_vercel/'));
  assert.ok(urls.length >= places.length, `the page list has ${urls.length} pages for ${places.length} places`);
  const bySlug = Object.fromEntries(places.map((p) => [S.toSlug(p.name), p]));
  const problems = (await inBatches(urls, 6, async (u) => {
    const url = BASE + new URL(u).pathname;
    const res = await get(url);
    const html = await res.text();
    const out = [];
    if (res.status !== 200) out.push(`answered ${res.status}`);
    if (S.CAVE_WORD.test(html)) out.push('mentions caves');
    const stray = S.strayCoordinates(html, freePlaces);
    if (stray.length) out.push(`${stray.length} GPS-looking number(s) that aren't a free place's`);
    const m = /\/places\/([^/]+)$/.exec(url);
    if (m) {
      const p = bySlug[m[1]];
      if (!p) out.push('not a live place');
      else if (S.isFree(p) && !html.includes(String(p.latitude))) out.push('free GPS missing');
      else if (!S.isFree(p) && !html.includes(`Unlock GPS for ${S.PRICE}`)) out.push('the $4.99 unlock is missing');
    }
    if (/\/near\//.test(url) && S.hasAnyCoordinates(html)) out.push('a town page shows coordinates');
    return out.length ? `${url}: ${out.join('; ')}` : null;
  })).filter(Boolean);
  assert.deepEqual(problems, []);
});

test('category pages, the old /caves link and the link preview', async () => {
  for (const c of ['camp', 'swimming', 'views', 'bluffs', 'forgotten', 'frogs', 'legends', 'buildings', 'dead-ends', 'mud', 'hiking', 'popular', 'wheeling', 'unmarked', 'long-shot']) {
    const res = await get(`${BASE}/${c}`);
    const html = await res.text();
    assert.equal(res.status, 200, `/${c}`);
    assert.ok(!S.CAVE_WORD.test(html), `/${c} mentions caves`);
  }
  const caves = await get(`${BASE}/caves`);
  assert.ok([301, 302, 307, 308].includes(caves.status), `/caves answered ${caves.status}`);
  assert.equal(new URL(caves.headers.get('location'), BASE).pathname, '/');
  const home = await (await get(`${BASE}/`)).text();
  assert.ok(home.includes(`find the ${S.NEAR_COUNT} places closest to you`), 'the link preview does not say 5');
  assert.match(home, new RegExp(`NEAR_PAGE_SIZE:\\s*${S.NEAR_COUNT}\\b`));
  for (const f of ['place-page.js', 'manifest.json']) assert.ok(!S.CAVE_WORD.test(await (await get(`${BASE}/${f}`)).text()), `${f} mentions caves`);
});

test('the weekly Bing ping refuses anyone without its lock', async () => {
  const res = await get(`${BASE}/api/indexnow`);
  assert.equal(res.status, 401);
});
