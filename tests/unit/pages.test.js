// The Google-facing pages (place pages, town pages, category pages, page list) built from pretend data,
// including a paid place whose GPS "leaks" out of the database, as if the public view were broken one day.
// The pages must still never show it. Run from the repo root: node --test tests/unit/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/site');

const ROOT = path.join(__dirname, '..', '..');
const FREE = { id: 1, name: 'Dead End #1', category: 'Dead end trails', access: 'Free', latitude: 37.58007, longitude: -92.31136, description: 'Two dead end trails off a forest road.' };
const SAMPLE = { id: 2, name: 'Popular Location #2', category: 'Popular locations', access: 'Free', latitude: 36.81234, longitude: -92.45678, description: 'A popular spot.' };
const PAID = { id: 3, name: 'Campsite #8', category: 'Established campsites', access: 'Paid', latitude: 37.11111, longitude: -92.22222, description: 'A good spot to set up camp.' };
const PAID2 = { id: 4, name: 'Wheeling #2', category: 'Wheeling', access: 'Paid', latitude: 36.99999, longitude: -91.88888, description: 'Good rocks to crawl.' };
const ROWS = [FREE, SAMPLE, PAID, PAID2];
const FREE_ROWS = [FREE, SAMPLE];

// Pretend database: answers the same calls the pages make to the live one
global.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.includes('/rest/v1/poi_public_locations')) return json(ROWS);
  if (u.includes('/rest/v1/poi_public_photos')) return json([]);
  if (u.includes('/rest/v1/rpc/poi_distances')) {
    const at = JSON.parse(init.body || '{}');
    return json(ROWS.map((r) => ({ id: r.id, miles: Math.round(S.milesBetween({ latitude: at.user_lat, longitude: at.user_lng }, r)) })));
  }
  throw new Error('Unexpected call in the test: ' + u);
};

// Runs one of the api/ pages the way Vercel does
function call(name, query) {
  const handler = require(path.join(ROOT, 'api', name + '.js'));
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200, headersSent: false,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      getHeader(k) { return headers[k.toLowerCase()]; },
      end(body) { resolve({ status: this.statusCode, headers, body: body == null ? '' : String(body) }); }
    };
    Promise.resolve(handler({ query, headers: {}, method: 'GET', url: '/' }, res)).catch(reject);
  });
}

test('a paid place page shows no GPS, even if the database sent it', async () => {
  const r = await call('place', { s: 'campsite-8' });
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes('37.111') && !r.body.includes('92.222'), 'the paid GPS is on the page');
  assert.deepEqual(S.strayCoordinates(r.body, FREE_ROWS), [], 'GPS that is not a free place is on the page');
  assert.ok(r.body.includes(`Unlock GPS for ${S.PRICE}`), 'the $4.99 unlock button is missing');
  assert.ok(r.body.includes('Secure checkout by Stripe'), 'the secure checkout line is missing');
});

test('a free place page shows its GPS', async () => {
  const r = await call('place', { s: 'dead-end-1' });
  assert.equal(r.status, 200);
  assert.ok(r.body.includes('37.58007') && r.body.includes('-92.31136'), 'the free GPS is missing');
  assert.ok(!r.body.includes(`Unlock GPS for ${S.PRICE}`), 'a free place offers an unlock');
});

test('an unknown place page answers "not found"', async () => {
  const r = await call('place', { s: 'cave-4' });
  assert.equal(r.status, 404);
});

test('town pages show no coordinates and say nothing about caves', async () => {
  const { TOWNS } = require(path.join(ROOT, 'api', '_site.js'));
  assert.ok(TOWNS.length >= 10);
  for (const t of TOWNS) {
    assert.ok(!S.CAVE_WORD.test(t.intro), `${t.name}'s intro mentions caves`);
    const r = await call('near', { t: t.slug });
    assert.equal(r.status, 200, `${t.name} page`);
    assert.ok(!S.hasAnyCoordinates(r.body), `${t.name} page shows coordinates`);
    assert.ok(!S.CAVE_WORD.test(r.body), `${t.name} page mentions caves`);
  }
});

test('the page list for Google has no coordinates and no caves', async () => {
  const r = await call('sitemap', {});
  assert.equal(r.status, 200);
  assert.ok(!S.hasAnyCoordinates(r.body));
  assert.ok(!S.CAVE_WORD.test(r.body));
  for (const p of ROWS) assert.ok(r.body.includes(`/places/${S.toSlug(p.name)}<`), `${p.name} is missing`);
  for (const c of ['dead-ends', 'popular', 'camp', 'wheeling']) assert.ok(r.body.includes(`https://localamerica.us/${c}<`), `/${c} is missing`);
  assert.ok(!r.body.includes('/caves<'), 'the page list has /caves');
});

test('category pages work, and /caves is not one of them', async () => {
  const slugs = ['camp', 'swimming', 'views', 'bluffs', 'forgotten', 'frogs', 'legends', 'buildings', 'dead-ends', 'mud', 'hiking', 'popular', 'wheeling', 'unmarked', 'long-shot'];
  for (const c of slugs) {
    const r = await call('category', { c });
    assert.equal(r.status, 200, `/${c}`);
    assert.ok(!S.CAVE_WORD.test(r.body), `/${c} mentions caves`);
    assert.ok(r.body.includes(`<link rel="canonical" href="https://localamerica.us/${c}">`), `/${c} should be its own address for Google`);
  }
  const caves = await call('category', { c: 'caves' });
  assert.ok([301, 302, 307, 308].includes(caves.status) && caves.headers.location === '/', '/caves should go to Home');
});

test('the app file: Near me shows 5, the link preview matches, no caves anywhere', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /NEAR_PAGE_SIZE:\s*5\b/);
  assert.ok(html.includes('<link rel="canonical" href="https://localamerica.us/">'), 'home page has no canonical address');
  const previews = [...html.matchAll(/<meta (?:name="description"|property="og:description") content="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(previews.length, 2);
  for (const d of previews) assert.ok(d.includes(`find the ${S.NEAR_COUNT} places closest to you`), 'link preview: ' + d);
  for (const f of ['index.html', 'place-page.js', 'pixel.js', 'manifest.json', 'sw.js', 'cards.html', 'pins.html', 'towns.html', 'traffic.html']) {
    assert.ok(!S.CAVE_WORD.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} mentions caves`);
  }
});

test('vercel.json: /caves goes to Home and is not a category link', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const r = (cfg.redirects || []).find((x) => x.source === '/caves');
  assert.ok(r && r.destination === '/', 'missing /caves redirect');
  for (const w of cfg.rewrites || []) assert.ok(!/caves/.test(w.source), 'a rewrite still serves /caves');
});

test('pin approvals: no Cave place type', () => {
  const src = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'pin-review', 'index.ts'), 'utf8');
  const list = /const CATEGORIES = \[([\s\S]*?)\];/.exec(src);
  assert.ok(list, 'CATEGORIES list not found');
  assert.ok(!/cave/i.test(list[1]), 'Caves is still a place type a pin can become');
  assert.match(src, /if \(CAVE\.test\(description\)\)/, 'approve should refuse a description about a cave');
});
