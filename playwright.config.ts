import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4790);
const baseURL = `http://127.0.0.1:${port}`;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/maria.json' },
      dependencies: ['setup'],
    },
  ],
  // A fresh server and database for every run, serving the production build (with its Content-Security-Policy).
  webServer: {
    command: 'npm run build && node e2e/server.ts',
    url: `${baseURL}/api/auth/config`,
    env: { E2E_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
