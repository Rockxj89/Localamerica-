// The app in a real (phone-sized) browser: GPS shown or hidden, the $4.99 unlock, the unlock being saved in
// the buyer's browser, Near me, and no caves. Uses the live public place data (read only).
// Checkout is answered by a pretend checkout inside the test, so no Stripe checkout is ever opened, and
// guard() stops every visit from reaching Traffic, the Meta pixel or anything else outside the app.
const { test, expect } = require('@playwright/test');
const S = require('../lib/site');

const FAKE_GPS = { latitude: 36.00001, longitude: -92.00001 }; // made up; only ever shown inside the test
const ALLOWED_HOSTS = new Set(['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

let places, free, paid, freePlaces;
test.beforeAll(async () => {
  places = await S.publicPlaces();
  freePlaces = places.filter(S.isFree);
  free = freePlaces.find((p) => p.latitude != null && p.category !== 'Popular locations') || freePlaces[0];
  paid = places.find((p) => !S.isFree(p) && p.category === 'Established campsites') || places.find((p) => !S.isFree(p));
  expect(free, 'a free place with GPS').toBeTruthy();
  expect(paid, 'a paid place').toBeTruthy();
});

// Sends test traffic only where it's harmless, and answers checkout calls with a pretend checkout.
async function guard(context, baseURL) {
  const base = new URL(baseURL).origin;
  const state = { calls: [], unlocked: {}, sessionId: 'cs_test_pretend123', placeId: null, stopped: [], errors: [], leaked: [], traffic: [] };
  // Any script error on a page fails the test, and so does any visit-counting or pixel request that
  // got through (both checked by noErrors at the end of each test)
  const watch = (pg) => pg.on('pageerror', (e) => state.errors.push(String(e.message || e)));
  context.pages().forEach(watch);
  context.on('page', watch);
  context.on('requestfinished', (r) => { if (/poi_traffic_events|facebook\.(com|net)/.test(r.url())) state.leaked.push(r.method() + ' ' + new URL(r.url()).hostname); });
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (url.href.split('?')[0] === S.CHECKOUT_URL) {
      if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: CORS, body: 'ok' });
      const body = JSON.parse(req.postData() || '{}');
      state.calls.push(body);
      let answer = { ok: false, error: 'Unknown action.' };
      if (body.action === 'unlocked') answer = { ok: true, places: state.unlocked[body.token] || [] };
      if (body.action === 'start') answer = { ok: true, url: `https://checkout.stripe.com/c/pay/${state.sessionId}` };
      if (body.action === 'complete' && body.sessionId === state.sessionId && state.placeId != null) {
        state.unlocked[body.token] = [{ id: state.placeId, ...FAKE_GPS }];
        answer = { ok: true, locationId: state.placeId };
      }
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(answer) });
    }
    if (url.hostname === 'checkout.stripe.com') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Pretend Stripe page (test)</p>' });
    }
    if (url.hostname === new URL(S.SUPABASE_URL).hostname) {
      if (url.pathname.startsWith('/storage/')) return route.abort(); // photos aren't needed; saves bandwidth
      const read = method === 'GET' || method === 'HEAD' || (method === 'POST' && url.pathname === '/rest/v1/rpc/poi_distances');
      if (read) return route.continue();
      if (method === 'POST' && url.pathname === '/rest/v1/poi_traffic_events') {
        try { state.traffic.push(...[].concat(JSON.parse(req.postData() || '[]'))); } catch (e) { /* not JSON */ }
      }
      state.stopped.push(`${method} ${url.pathname}`); // visit counting and anything else that writes
      return route.abort();
    }
    // Offline copies, only for runs on a computer that can't reach the script sites (not used on GitHub)
    if (process.env.LA_LOCAL_CDN_DIR && url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('supabase-js')) {
      return route.fulfill({ path: require('path').join(process.env.LA_LOCAL_CDN_DIR, 'supabase.js'), contentType: 'text/javascript' });
    }
    if (process.env.LA_LOCAL_CDN_DIR && (url.hostname === 'cdn.tailwindcss.com' || url.hostname.startsWith('fonts.'))) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind = window.tailwind || {};' });
    }
    if (url.origin === base || ALLOWED_HOSTS.has(url.hostname)) {
      if (req.resourceType() === 'image' || url.pathname.startsWith('/_vercel/image')) return route.abort();
      return route.continue();
    }
    state.stopped.push(url.hostname); // the Meta pixel and anything else
    return route.abort();
  });
  return state;
}

const noErrors = (state) => {
  expect(state.errors, 'script errors on the page').toEqual([]);
  expect(state.leaked, 'visit counting or the pixel got through').toEqual([]);
};
// The run log is public: these checks report counts and yes/no, never the page's numbers or text
const strayCount = async (page) => S.strayCoordinates(await page.content(), freePlaces).length;
const mentionsCaves = async (page) => S.CAVE_WORD.test(await bodyText(page)) || S.CAVE_WORD.test(await page.content());
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const token = (page) => page.evaluate(() => localStorage.getItem('la_access_token'));
const gpsText = (p) => `${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}`;

test('a free place shows its GPS', async ({ page, context, baseURL }) => {
  const state = await guard(context, baseURL);
  await page.goto(`/#/p/${free.id}`);
  await expect(page.locator('h1', { hasText: free.name })).toBeVisible();
  await expect(page.getByText(gpsText(free)).first()).toBeVisible();
  await expect(page.getByText('Free access').first()).toBeVisible();
  await expect(page.getByText(`Unlock GPS for ${S.PRICE}`)).toHaveCount(0);
  noErrors(state);
});

test('a paid place shows no GPS, only the $4.99 unlock', async ({ page, context, baseURL }) => {
  const state = await guard(context, baseURL);
  await page.goto(`/#/p/${paid.id}`);
  await expect(page.locator('h1', { hasText: paid.name })).toBeVisible();
  await expect(page.getByRole('button', { name: `Unlock GPS for ${S.PRICE}` })).toBeVisible();
  await expect(page.getByText('Secure checkout by Stripe')).toBeVisible();
  await expect(page.getByText('Paid access').first()).toBeVisible();
  expect(await strayCount(page), 'GPS-looking numbers that are not a free place').toBe(0);
  noErrors(state);
});

test('the unlock button opens a Stripe checkout for that place, tied to this browser', async ({ page, context, baseURL }) => {
  const state = await guard(context, baseURL);
  await page.goto(`/#/p/${paid.id}`);
  await page.getByRole('button', { name: `Unlock GPS for ${S.PRICE}` }).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//);
  const start = state.calls.find((c) => c.action === 'start');
  expect(start, 'the app asked checkout to start').toBeTruthy();
  expect(Number(start.locationId)).toBe(Number(paid.id));
  expect(start.token).toMatch(/^[a-f0-9]{64}$/);
  expect(start.returnUrl.startsWith(new URL(baseURL).origin)).toBe(true);
  noErrors(state);
});

test('after paying, the GPS shows, stays after a reload, and only in that browser', async ({ browser, baseURL }) => {
  const buyer = await browser.newContext();
  const state = await guard(buyer, baseURL);
  state.placeId = paid.id;
  const page = await buyer.newPage();
  // Stripe sends the buyer back here after paying
  await page.goto(`/?checkout=success&session_id=${state.sessionId}#/p/${paid.id}`);
  await expect(page.getByText('Payment confirmed.')).toBeVisible();
  await expect(page.getByText(gpsText(FAKE_GPS)).first()).toBeVisible();
  const t = await token(page);
  const complete = state.calls.find((c) => c.action === 'complete');
  expect(complete.token).toBe(t);
  // Later visit in the same browser: the saved purchase brings the GPS back
  state.calls.length = 0;
  await page.goto('/');
  await page.goto(`/#/p/${paid.id}`);
  await page.reload();
  await expect(page.locator('h1', { hasText: paid.name })).toBeVisible();
  await expect(page.getByText(gpsText(FAKE_GPS)).first()).toBeVisible();
  expect(await token(page)).toBe(t);
  expect(state.calls.some((c) => c.action === 'unlocked' && c.token === t)).toBe(true);
  // A different browser (or a cleared one) doesn't get it
  const other = await browser.newContext();
  const otherState = await guard(other, baseURL);
  otherState.unlocked = state.unlocked;
  const page2 = await other.newPage();
  await page2.goto(`/#/p/${paid.id}`);
  await expect(page2.getByRole('button', { name: `Unlock GPS for ${S.PRICE}` })).toBeVisible();
  expect((await bodyText(page2)).includes(gpsText(FAKE_GPS)), 'the other browser shows the GPS').toBe(false);
  expect(await token(page2)).not.toBe(t);
  noErrors(state);
  noErrors(otherState);
  await buyer.close();
  await other.close();
});

test('Near me shows only the closest 5, nearest first', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ geolocation: S.AVA, permissions: ['geolocation'] });
  const state = await guard(context, baseURL);
  const page = await context.newPage();
  await page.goto('/#/c/camp');
  await page.getByRole('button', { name: 'Near me' }).click();
  await expect(page.getByText(`Showing the closest ${S.NEAR_COUNT} campsites`)).toBeVisible();
  const cards = page.locator('article:has(a[href^="#/p/"])');
  await expect(cards).toHaveCount(S.NEAR_COUNT);
  await expect(page.getByRole('button', { name: 'Show more places' })).toHaveCount(0);
  const shownIds = await cards.evaluateAll((els) => els.map((e) => Number(e.querySelector('a[href^="#/p/"]').getAttribute('href').split('/').pop())));
  const labels = await cards.evaluateAll((els) => els.map((e) => e.querySelector('[data-act="dist"]').textContent));
  const shownMiles = labels.map((l) => Number(/About ([\d.]+) mi/.exec(l)[1]));
  expect(shownMiles, 'nearest first').toEqual([...shownMiles].sort((a, b) => a - b));
  // Nothing closer was left out (same miles the app got, from the public distance function)
  const miles = Object.fromEntries((await S.distancesFrom(S.AVA)).map((r) => [r.id, Number(r.miles)]));
  const camps = places.filter((p) => p.category === 'Established campsites' && miles[p.id] != null && miles[p.id] <= S.NEAR_MILES);
  const farthestShown = Math.max(...shownIds.map((id) => miles[id]));
  for (const p of camps) if (!shownIds.includes(p.id)) expect(miles[p.id], `${p.name} is closer than a place shown`).toBeGreaterThanOrEqual(farthestShown);
  noErrors(state);
  await context.close();
});

test('no caves: not on Home, not on About, and /caves goes to Home', async ({ page, context, baseURL, request }) => {
  const state = await guard(context, baseURL);
  await page.goto('/');
  await expect(page.locator('a[href^="#/c/"]').first()).toBeVisible();
  expect(await mentionsCaves(page), 'Home mentions caves').toBe(false);
  await page.goto('/#/about');
  await expect(page.getByText('Our mission')).toBeVisible();
  expect(await mentionsCaves(page), 'About mentions caves').toBe(false);
  await page.goto('/#/c/caves');
  await page.waitForTimeout(1000);
  expect(S.CAVE_WORD.test(await bodyText(page)), '#/c/caves mentions caves').toBe(false);
  const r = await request.get('/caves', { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(r.status());
  expect(new URL(r.headers().location, baseURL).pathname).toBe('/');
  noErrors(state);
});

test('a paid place page for Google shows no GPS, and its unlock opens checkout for that place', async ({ page, context, baseURL }) => {
  const state = await guard(context, baseURL);
  await page.goto(`/places/${S.toSlug(paid.name)}`);
  await expect(page.locator('h1', { hasText: paid.name })).toBeVisible();
  expect(await strayCount(page), 'GPS-looking numbers that are not a free place').toBe(0);
  await page.getByRole('button', { name: `Unlock GPS for ${S.PRICE}` }).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//);
  const start = state.calls.find((c) => c.action === 'start');
  expect(Number(start.locationId)).toBe(Number(paid.id));
  noErrors(state);
});

test('a free place page for Google shows its GPS', async ({ page, context, baseURL }) => {
  const state = await guard(context, baseURL);
  await page.goto(`/places/${S.toSlug(free.name)}`);
  await expect(page.locator('h1', { hasText: free.name })).toBeVisible();
  expect((await page.content()).includes(String(free.latitude)), 'the free GPS is missing').toBe(true);
  noErrors(state);
});


test('a link tag (?from=) goes with every visit event, and a place type link with Facebook\'s ?fbclid still opens', async ({ page, context, baseURL }) => {
  const state = await guard(context, baseURL);
  // Facebook adds ?fbclid=... to links; the place type page used to send that visitor to Home
  await page.goto('/camp?from=Test-Tag_1&fbclid=test123');
  await expect.poll(() => state.traffic.some((r) => r.event_type === 'category_view' && r.event_metadata && r.event_metadata.category),
    { message: 'the place type list did not open' }).toBe(true);
  expect(new URL(page.url()).hash, 'the page moved away from the place type list').toMatch(/^#\/c\/[a-z-]+$/);
  expect(state.traffic.every((r) => r.event_metadata && r.event_metadata.src === 'test-tag-1'), 'an event is missing the link tag').toBe(true);
  // The place pages for Google keep the tag too (a new tab, so the visit starts fresh)
  const other = await context.newPage();
  await other.goto(`/places/${S.toSlug(free.name)}?from=place-test`);
  await expect(other.locator('h1', { hasText: free.name })).toBeVisible();
  await expect.poll(() => state.traffic.some((r) => r.event_metadata && r.event_metadata.src === 'place-test'),
    { message: 'the place page did not send the link tag' }).toBe(true);
  noErrors(state);
});
