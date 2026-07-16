const { devices } = require('@playwright/test');

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
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /.*desktop\.spec\.js/,
    },
    {
      name: 'Mobile Chrome',
      use: { 
        ...devices['Pixel 5'],
        hasTouch: true,
      },
      testMatch: /.*mobile\.spec\.js/,
    },
    {
      name: 'Tablet Chrome',
      use: { 
        ...devices['Galaxy Tab S4'],
        hasTouch: true,
      },
      testMatch: /.*mobile\.spec\.js/,
    }
  ],
  webServer: {
    command: 'npx http-server -p 8001 -c-1',
    url: 'http://localhost:8001',
    reuseExistingServer: true,
    timeout: 10000
  },
};
