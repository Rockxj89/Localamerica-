# Automatic tests

These check the money and location paths of Local America by themselves. They run on GitHub
("Tests" under the repo's Actions tab):

- **On every pull request:** before a change goes live. Results show on the pull request; Claude doesn't merge until they pass.
- **After every merge, and every day at 7:23 a.m. Central:** against the live site. If a live check fails, GitHub opens an issue called "Live check failed", which emails the owner.
- **By hand:** Actions, Tests, Run workflow.

## What they check
- **Checkout** (`unit/checkout.test.ts`): the real checkout function with a pretend Stripe and a pretend database. It only sells paid places, at $4.99 USD, tied to the buyer's browser. A place unlocks only after Stripe says it was paid in full, in US dollars, for that place and that browser. Free, archived and made-up places are refused, and the hourly limits hold.
- **Google pages** (`unit/pages.test.js`): place, town and category pages and the page list, built from pretend data that includes a paid place with its GPS "leaking" from the database. Paid GPS never shows. Free GPS does. Town pages show no coordinates, and nothing mentions caves.
- **The app in a phone-sized browser** (`e2e/app.spec.js`): a free place shows GPS, while a paid one shows only the $4.99 unlock. The unlock button opens checkout for that place. After paying, the GPS shows, stays after a reload, and doesn't appear in another browser. Near me shows the closest 5, nearest first, with no "show more". No caves, and /caves goes to Home.
- **The live site** (`live/live.test.js`): it runs the latest code. Public data has no paid GPS. Private tables and owner tools are closed to the public. Free places' miles are measured to their real spot. Checkout refuses free and made-up places. Every page in the page list shows no paid GPS and no caves. The Bing ping is locked.

## Safety
- No keys or secrets are used; only the public addresses every visitor uses.
- Nothing is paid and no real Stripe checkout is opened. The live checkout is only asked questions it refuses before Stripe is contacted.
- Test visits never reach the Traffic page or the Meta pixel: the browser tests block both, and plain page loads run no scripts.
- Photos aren't downloaded, to save bandwidth.

## Running them by hand (for Claude)
From the repo root:
- `node --test "tests/unit/*.test.js"` and `deno test --allow-env tests/unit/checkout.test.ts`
- `cd tests && npm ci && npx playwright install chromium && npx playwright test`
  (uses `tests/server.js` as a local stand-in for Vercel; set `BASE_URL=https://localamerica.us` to test the live site)
- `node --test "tests/live/*.test.js"`

In Claude's workspace, which can't reach the script sites, add `CHROME_PATH=/usr/bin/google-chrome`,
`LA_BROWSER_PROXY=$HTTPS_PROXY` and `LA_LOCAL_CDN_DIR=<folder holding supabase.js from @supabase/supabase-js@2.45.4 dist/umd>`.

When the owner's rules change (for example the Near me count or the price), change `tests/lib/site.js` in the same pull request.
