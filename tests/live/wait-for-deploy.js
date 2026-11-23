// After a merge, wait until this commit is live before the live checks run:
// 1) Vercel's own "Vercel" status on the commit says the deployment finished (fails here if Vercel says it failed);
// 2) localamerica.us serves the same index.html as this commit.
// Up to 10 minutes. Scheduled and manual runs skip step 1 (main is already live).
// If the site still doesn't match, the "latest code" check reports it.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.env.LIVE_URL || 'https://localamerica.us').replace(/\/$/, '');
const want = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'))).digest('hex');
const { GITHUB_SHA: sha, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token, GITHUB_EVENT_NAME: event } = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function vercelStatus() {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/status`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) return null;
  const s = ((await res.json()).statuses || []).find((x) => /vercel/i.test(x.context));
  return s ? s.state : null;
}

(async () => {
  const until = Date.now() + 10 * 60 * 1000;
  if (event === 'push' && sha && repo && token) {
    while (Date.now() < until) {
      let state = null;
      try { state = await vercelStatus(); } catch (e) { console.log('GitHub not reachable: ' + e.message); }
      if (state === 'success') { console.log('Vercel finished deploying this commit.'); break; }
      if (state === 'failure' || state === 'error') {
        console.log('::error title=Deploy::Vercel says the deployment of this commit failed, so it is not live.');
        process.exit(1);
      }
      console.log(`Waiting for Vercel (status: ${state || 'not posted yet'})...`);
      await sleep(15000);
    }
    await sleep(20000); // a moment for the new version to reach every server
  }
  while (Date.now() < until) {
    try {
      const res = await fetch(`${BASE}/index.html?wait=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const got = crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex');
      if (got === want) { console.log('The live site serves this version.'); return; }
    } catch (e) { console.log('Not reachable yet: ' + e.message); }
    console.log('Waiting for the live site to update...');
    await sleep(15000);
  }
  console.log('The live site did not update within 10 minutes.');
})();
