import { defineConfig } from 'vitest/config';

/**
 * Browser end-to-end suite (`npm run test:e2e`). Runs against the production
 * build served by the real server — one staging instance (platform + sample
 * data on) and one production-mode instance (all flags off) — on throwaway
 * databases. Requires `npm run build` first (the script does it) and a
 * Playwright Chromium (`npx playwright install chromium` outside this container).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.ts'],
    globalSetup: ['tests/e2e/global-setup.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});
