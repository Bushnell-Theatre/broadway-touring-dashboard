const { defineConfig, devices } = require('@playwright/test');

/*
 * Playwright — browser smoke tests for the four dashboard pages.
 *
 * These exist because this project's recurring failure mode is a page that
 * loads fine and then breaks on interaction: a renamed tab ID, a render
 * function that no longer exists, a panel that never fills. Nothing in the
 * Node/Python test suites can see that — they read source text, not a running
 * page.
 *
 * The server is plain `python -m http.server` against src/, the same command
 * in .claude/launch.json. No new dependency, and the pages are served exactly
 * as Azure Static Web Apps serves them. Python is already a hard requirement
 * for the data pipeline.
 *
 * Run with: npm run test:smoke
 */
module.exports = defineConfig({
  testDir: './test/smoke',

  // data.json is 8 MB; a cold page load plus render is not instant.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // Single worker: one python http.server, and the pages are heavy.
  fullyParallel: false,
  workers: 1,

  reporter: [['list']],

  use: {
    baseURL: 'http://127.0.0.1:5173',
    // A desktop viewport. Below 900px the sidebar collapses to a toggle and
    // the tab controls stop being directly clickable.
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'python -m http.server 5173 --directory src',
    url: 'http://127.0.0.1:5173/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
