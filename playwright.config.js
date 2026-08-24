const { devices, chromium, webkit } = require('@playwright/test');
const fs = require('fs');

// Only include a browser's projects if that browser is actually installed. A contributor with
// just Chromium (or a pure free-software developer who declines to install the WebKit build)
// must still be able to run the suite -- the missing profiles are simply skipped, with a warning,
// never a hard failure. Detection is by the presence of the browser executable Playwright would
// use; executablePath() throws or points at a non-existent file when the browser isn't installed.
function browserAvailable(browserType) {
  try {
    const p = browserType.executablePath();
    return !!p && fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

const hasChromium = browserAvailable(chromium);
const hasWebkit = browserAvailable(webkit);

const projects = [];

if (hasChromium) {
  projects.push(
    {
      name: 'Desktop Chrome',
      // Also generates the desktop profile of the screenshots/ fixture (exploratory), so the
      // viewer shows how the app renders on a real desktop layout, not only mobile/tablet.
      // stories.desktop.spec.js is already covered by the "desktop" alternative below -- no
      // separate "stories" alternative needed once every story file carries an interface suffix.
      use: { ...devices['Desktop Chrome'] },
      testMatch: /.*(desktop|exploratory)\.spec\.js/,
    },
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        hasTouch: true,
      },
      // stories.mobile.spec.js doesn't exist yet (no real mobile-recorded session to build one
      // from) -- matched in advance, same as stories.desktop.spec.js already is for Desktop
      // Chrome, so a story built for this interface actually runs under ITS real project (touch
      // emulation, mobile UA, mobile viewport) instead of just a narrowed desktop one.
      testMatch: /.*(mobile|invariants|exploratory|stories\.mobile)\.spec\.js/,
    },
    {
      name: 'Tablet Chrome',
      use: {
        ...devices['Galaxy Tab S4'],
        hasTouch: true,
      },
      // stories.tablet.spec.js: same reasoning as Mobile Chrome's testMatch above.
      testMatch: /.*(mobile|invariants|exploratory|stories\.tablet)\.spec\.js/,
    }
  );
} else {
  console.warn('[playwright] Chromium is not installed -- skipping the Desktop/Mobile/Tablet Chrome projects (the bulk of the suite). Install it with `npx playwright install chromium`.');
}

if (hasWebkit) {
  projects.push({
    // iOS Safari (WebKit) -- the only non-Chromium engine, so the one that actually surfaces
    // Safari-specific rendering. Scoped to the exploratory fixture only: the full mobile/
    // invariants suite leans on Chromium-only features (e.g. the File System Access folder
    // picker) that WebKit lacks, so running all of it here would report unrelated failures.
    // The fixture just drives + screenshots the app, which WebKit handles fine.
    name: 'Mobile Safari',
    use: {
      ...devices['iPhone 13'],
    },
    // stories.mobile.spec.js (once one exists) also runs here -- it's a mobile-interface story,
    // not a Chrome-specific one, so it belongs on the one non-Chromium engine too. Doesn't share
    // Mobile Chrome's exclusion of the full mobile/invariants suite (see the comment above): a
    // story test just drives + asserts on real gameplay outcomes, no File System Access API or
    // other Chromium-only feature involved, so it's not subject to the same WebKit gap.
    testMatch: /.*(exploratory|stories\.mobile)\.spec\.js/,
  });
} else {
  console.warn('[playwright] WebKit is not installed -- skipping the iOS (Safari) fixture profile. This is optional; the rest of the suite runs without it. Install it with `npx playwright install webkit` to include the iOS screenshots.');
}

module.exports = {
  testDir: './tests',
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  forbiddenOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single-worker to avoid audio context and state collision
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8001',
    trace: 'on-first-retry',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  projects,
  webServer: {
    command: 'npx http-server -p 8001 -c-1',
    url: 'http://localhost:8001',
    reuseExistingServer: true,
    timeout: 20000
  },
};
