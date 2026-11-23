// After a merge, Vercel takes about a minute to put the new version live. This waits (up to 8 minutes)
// until localamerica.us serves the same index.html as main, so the live checks test the new version.
// It never fails by itself: if the site doesn't update, the "latest code" check reports it.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.env.LIVE_URL || 'https://localamerica.us').replace(/\/$/, '');
const want = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'))).digest('hex');

(async () => {
  const until = Date.now() + 8 * 60 * 1000;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${BASE}/index.html?wait=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const got = crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
      if (got === want) { console.log('The live site serves this version.'); return; }
    } catch (e) { console.log('Not reachable yet: ' + e.message); }
    console.log('Waiting for the live site to update...');
    await new Promise((r) => setTimeout(r, 15000));
  }
  console.log('The live site did not update within 8 minutes.');
})();
