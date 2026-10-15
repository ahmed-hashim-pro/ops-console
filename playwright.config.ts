import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['E2E_PORT'] ?? 4300);

// Runs against the production build served by server/server.mjs
// (npm run build first). See e2e/.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env['CI'] ? 2 : 3,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: `node server/server.mjs`,
    env: { PORT: String(port) },
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
  },
});
