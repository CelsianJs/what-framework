// Playwright E2E test configuration for What Framework
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1, // Serial — tests share a Vite server
  use: {
    headless: true,
    baseURL: 'http://localhost:3998',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 5000,
  },
  webServer: {
    command: 'npx vite --config e2e/fixture/vite.config.js --port 3998 --strictPort',
    port: 3998,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
