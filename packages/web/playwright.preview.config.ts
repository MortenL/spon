import { defineConfig, devices } from '@playwright/test';

/**
 * Runs cad.spec.ts against the production build (`vite build` + `vite preview`) instead of the dev server. The dev
 * server pre-bundles the Emscripten glue with esbuild; the production worker chunk comes from Rolldown's CommonJS
 * interop instead, and has to be run at least once to know it actually works.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'cad.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL: 'http://localhost:5198', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 900 },
        // software WebGL so the three.js viewport renders headless
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: 'pnpm exec vite build && pnpm exec vite preview --port 5198 --strictPort',
    url: 'http://localhost:5198',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
