import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'docs.spec.mjs',
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
    timeout: 120000,
  },
})
