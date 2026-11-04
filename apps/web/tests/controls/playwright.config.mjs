import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.', testMatch: 'controls.spec.mjs',
  use: {
    baseURL: 'http://127.0.0.1:4178', browserName: 'chromium',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: { cwd: '../..', command: 'pnpm exec vite --config tests/controls/vite.config.mjs', url: 'http://127.0.0.1:4178/tests/controls/', reuseExistingServer: false },
})
