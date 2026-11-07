import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['docs.spec.mjs', 'tooltip.spec.mjs', 'catalog.spec.mjs', 'overview.spec.mjs', 'component-review.spec.mjs', 'layout.spec.mjs', 'map-shell.spec.mjs', 'map-live.spec.mjs', 'tray.spec.mjs', 'community.spec.mjs'],
  use: {
    baseURL: 'http://127.0.0.1:6011',
    browserName: 'chromium',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    cwd: '../..',
    command: 'pnpm exec storybook dev --port 6011 --host 127.0.0.1 --no-open --ci',
    url: 'http://127.0.0.1:6011',
    reuseExistingServer: false,
    env: { STORYBOOK_MAPS_TEST_MODE: '1' },
    timeout: 120000,
  },
})
