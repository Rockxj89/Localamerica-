// Weekly IndexNow ping (Bing and the other IndexNow search engines): tells them about every page
// in the sitemap. Vercel's timer calls it every Monday (see "crons" in vercel.json). It replaced the
// Make scenario "IndexNow – tell Bing" (7085590) in Nov 2026 and sends exactly what that one did.
//
// SAFETY: this address is public, so it does nothing unless the request carries the timer's secret
// (CRON_SECRET in the Vercel project's settings, never in this repo). Vercel adds it to its own
// timer calls by itself. Everyone else gets 401 and nothing is sent. If CRON_SECRET is missing,
// every call is refused, the timer's too. Only the public page list goes out: no GPS, nothing private.
const crypto = require('crypto');

const SITE = 'https://localamerica.us';
const INDEXNOW_KEY = 'eefc95dd7bc1b14253184b783f6a4f75'; // public; same key as api/sitemap.js and the key file
const PAGE_LIST = `${SITE}/sitemap.xml?format=indexnow`;  // home, town pages and place pages
const INDEXNOW = 'https://api.indexnow.org/indexnow';
const TIMEOUT_MS = 25000;

function allowed(req) {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return false;
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

async function fetchWithTimeout(url, opts) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function reply(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  // The timer sends GET (Vercel's newer Schedules send POST by default).
  if (req.method !== 'GET' && req.method !== 'POST') return reply(res, 405, { ok: false });
  if (!allowed(req)) return reply(res, 401, { ok: false });

  // 1. The page list, exactly as the sitemap builds it.
  let list;
  try {
    const r = await fetchWithTimeout(PAGE_LIST, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`page list answered ${r.status}`);
    list = await r.json();
  } catch (e) {
    console.error('IndexNow: could not get the page list:', e.message);
    return reply(res, 502, { ok: false, step: 'page list' });
  }
  // Only our own pages ever go out (IndexNow takes up to 10,000 per message).
  const urls = (Array.isArray(list && list.urlList) ? list.urlList : [])
    .filter((u) => typeof u === 'string' && u.startsWith(SITE + '/'))
    .slice(0, 10000);
  if (!urls.length) {
    console.error('IndexNow: the page list was empty');
    return reply(res, 502, { ok: false, step: 'page list' });
  }

  // 2. Send it. 200 = received, 202 = received (key check still pending); anything else is a problem.
  let status;
  try {
    const r = await fetchWithTimeout(INDEXNOW, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE).host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList: urls
      })
    });
    status = r.status;
  } catch (e) {
    console.error('IndexNow: sending failed:', e.message);
    return reply(res, 502, { ok: false, step: 'send' });
  }
  const ok = status === 200 || status === 202;
  (ok ? console.log : console.error)(`IndexNow: sent ${urls.length} pages, IndexNow answered ${status}`);
  return reply(res, ok ? 200 : 502, { ok, indexnow: status, pages: urls.length });
};
