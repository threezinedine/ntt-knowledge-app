import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.KM_E2E_PORT ?? 4399);
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // Data is per browser context (fresh each test); the hub's versions are shared, so serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // A stuck click or fill fails on its own, with its call log, instead of
    // as a bare "test timeout" (all CI shows of it).
    actionTimeout: 10_000,
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
      // Always the default level table (the specs assert its numbers), never a
      // level-config.json that happens to sit on this machine.
      KM_LEVEL_CONFIG: 'e2e-uses-default-level-config.json',
      KM_LOG_LEVEL: 'warn',
      // No Google in tests. Set explicitly so a developer's .env (which the
      // server reads, but never over an existing variable) can't turn it on.
      KM_AUTH: 'off',
      // Windows doesn't kill this server when Playwright dies (e.g. the UI-mode
      // window is closed); it would then hold the port and break the next run.
      KM_PARENT_PID: String(process.pid),
    },
  },
});
