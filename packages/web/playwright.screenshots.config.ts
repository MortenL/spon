import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Regenerates the README screenshots in docs/screenshots: pnpm --filter @sponcam/web screenshots
export default defineConfig({
  ...base,
  testDir: './screenshots',
  timeout: 120_000,
  retries: 2, // toolpath generation sometimes stalls in headless Chromium
  projects: [
    {
      name: 'chromium',
      use: {
        ...base.projects![0].use,
        viewport: { width: 1600, height: 960 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
