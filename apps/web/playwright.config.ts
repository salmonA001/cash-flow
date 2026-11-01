import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack (web on E2E_BASE_URL, API behind it, seeded DB).
 * Credentials come from E2E_EMAIL / E2E_PASSWORD. The session is created once in auth.setup.ts
 * (login is rate limited to 5/min per IP) and reused by every test.
 */
const AUTH = 'e2e/.auth/owner.json';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'anonymous', testMatch: /anonymous\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop', testMatch: /(navigation|workflows)\.spec\.ts/, dependencies: ['setup'], use: { ...devices['Desktop Chrome'], storageState: AUTH } },
    { name: 'mobile', testMatch: /navigation\.spec\.ts/, dependencies: ['setup'], use: { ...devices['Pixel 7'], storageState: AUTH } },
  ],
});
