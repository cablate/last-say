import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 3149);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PLAYWRIGHT_PORT must be an integer from 1 to 65535');
const runRoot = process.env.PLAYWRIGHT_E2E_ROOT || path.join(os.tmpdir(), 'last-say-browser-e2e-direct');
fs.mkdirSync(runRoot, { recursive: true });
const dbPath = path.join(runRoot, 'finance.sqlite');
const distDir = process.env.PLAYWRIGHT_E2E_DIST_DIR || 'outputs/.next-e2e-direct';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['line']] : 'line',
  outputDir: 'outputs/playwright-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/run-next-local.mjs dev',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(port),
      FINANCE_DB_PATH: dbPath,
      NEXT_DIST_DIR: distDir,
    },
  },
});
