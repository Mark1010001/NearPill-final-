import { defineConfig, devices } from '@playwright/test';

const external = process.env.PLAYWRIGHT_BASE_URL;
const chrome = process.env.NEARPILL_CAPSTONE_DEMO === '1' ? { channel: 'chrome' as const } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: true,
  // One local retry: the first page load after a cold Vite dev server start can exceed the wait while it compiles.
  retries: process.env.CI ? 2 : 1,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: external || 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: /google-map\.spec\.ts/, use: { ...devices['Desktop Chrome'], ...chrome } },
    // The Google Maps path needs a build-time browser key, so it runs against a second dev server that has a fake one.
    // The test replaces Google's script with a stub: no real key, no network call to Google.
    ...(external ? [] : [{ name: 'google-map', testMatch: /google-map\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...chrome, baseURL: 'http://127.0.0.1:5174' } }]),
  ],
  webServer: external ? undefined : [
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev -- --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
      env: { VITE_GOOGLE_MAPS_BROWSER_KEY: 'test-key-not-real', VITE_CACHE_DIR: 'node_modules/.vite-google' } },
  ],
});
