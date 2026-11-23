import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.KM_E2E_PORT ?? 4399);
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // Specs share one server + DB and reset it in `beforeEach`, so run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The PWA service worker would otherwise cache assets across runs.
    serviceWorkers: 'block',
    // Specs use English labels; i18n.spec.ts overrides this per test.
    locale: 'en-US',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      KM_PORT: String(PORT),
      KM_DB_PATH: ':memory:',
      KM_LOG_LEVEL: 'warn',
    },
  },
});
