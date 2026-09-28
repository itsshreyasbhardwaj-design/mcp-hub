import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The suite drives a real browser against a real Next.js server backed by a
 * real (embedded) PostgreSQL and the real example MCP servers — no mocking at
 * any layer. `webServer` builds and boots the app so a run is reproducible on
 * a laptop and in CI without a separate orchestration step.
 */
const PORT = Number.parseInt(process.env['E2E_PORT'] ?? '3210', 10);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ../../scripts/e2e-server.mjs ${PORT}`,
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
