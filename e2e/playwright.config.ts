import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './support/config';

/**
 * End-to-end suite for the editor and collaboration.
 *
 * The stack is expected to be running already (`./nd dev` with the E2E
 * database); Playwright does not start it. `global-setup.ts` fails fast with a
 * clear message when a service is missing, and seeds the shared account.
 *
 * Workers stay at 1: collaboration tests share a Yhub room and the seeded
 * account, so parallel documents would only add flakiness without coverage.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './global-setup',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
