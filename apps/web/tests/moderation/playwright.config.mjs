import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'review.spec.mjs',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {},
  },
  webServer: {
    cwd: '../../../..',
    command: 'node apps/web/.output/server/index.mjs',
    url: 'http://127.0.0.1:4178/api/health',
    reuseExistingServer: false,
    env: { HOST: '127.0.0.1', PORT: '4178' },
  },
})
