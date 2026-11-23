// Browser tests for the app (tests/e2e). On pull requests they run against the branch's own files
// (tests/server.js); after merges and every day they run against the live site (BASE_URL).
// No test visit ever reaches Traffic, the Meta pixel or Stripe: see guard() in e2e/app.spec.js.
const { defineConfig, devices } = require('@playwright/test');

const live = !!process.env.BASE_URL;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    serviceWorkers: 'block', // the app's offline helper must not get between the test and the network
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    // Only for runs on a computer with its own browser or a network proxy (not used on GitHub)
    launchOptions: {
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      ...(process.env.LA_BROWSER_PROXY ? { proxy: { server: process.env.LA_BROWSER_PROXY, bypass: 'localhost,127.0.0.1' } } : {})
    }
  },
  webServer: live ? undefined : {
    command: 'node server.js',
    url: 'http://localhost:3000/',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  }
});
