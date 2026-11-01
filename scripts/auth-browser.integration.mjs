import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('@playwright/test')

test('registration, reload, reset, and device logout with the Auth emulator', async () => {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_SESSION_ORIGIN: base, NUXT_FIREBASE_PROJECT_ID: 'demo-idea-map', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', NUXT_PUBLIC_FIREBASE_API_KEY: 'fake-key', NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'localhost', NUXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-idea-map', NUXT_PUBLIC_FIREBASE_AUTH_EMULATOR: 'http://127.0.0.1:9099' }, stdio: 'ignore' })
  let browser
  try {
    let ready = false
    for (let i = 0; i < 80; i++) { try { await fetch(`${base}/api/health`); ready = true; break } catch { await delay(250) } }
    assert.ok(ready)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(`${base}/account`)
    const email = `browser-${Date.now()}@example.test`
    await page.locator('#email').fill(email)
    await page.locator('#password').fill('example-password')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByText(`Signed in as ${email}`).waitFor({ timeout: 15000 })
    assert.ok((await page.context().cookies()).some(c => c.name === '__session' && c.httpOnly))
    await page.getByText('Check your email for a verification link.').waitFor()
    const messages = await (await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-idea-map/oobCodes')).json()
    const verification = messages.oobCodes.find(code => code.email === email && code.requestType === 'VERIFY_EMAIL')
    assert.ok(verification)
    const verified = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oobCode: verification.oobCode }) })
    assert.equal(verified.status, 200)
    await page.reload()
    await page.getByText(`Signed in as ${email}`).waitFor({ timeout: 15000 })
    const other = await browser.newContext()
    const second = await other.newPage()
    await second.goto(base + '/account')
    await second.locator('#email').fill(email)
    await second.locator('#password').fill('example-password')
    await second.getByRole('button', { name: 'Sign in', exact: true }).click()
    await second.getByText(`Signed in as ${email}`).waitFor({ timeout: 15000 })
    assert.deepEqual(await (await second.request.get(base + '/api/session')).json(), { registered: true, emailVerified: true })
    await page.getByRole('button', { name: 'Sign out on this device' }).click()
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
    assert.ok(!(await page.context().cookies()).some(c => c.name === '__session'))
    assert.ok((await other.cookies()).some(c => c.name === '__session'))
    await other.close()
    await page.locator('#email').fill(email)
    await page.getByRole('button', { name: 'Reset password' }).click()
    await page.getByText('If the address can be used, a reset email will be sent.').waitFor()
    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'Continue with Google' }).click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')
    await delay(1000)
    await popup.getByText('Add new account').click()
    const googleEmail = 'google-' + Date.now() + '@example.test'
    await popup.locator('input').first().fill(googleEmail)
    await popup.getByRole('button', { name: 'Sign in with Google.com' }).click()
    await page.getByText(`Signed in as ${googleEmail}`).waitFor({ timeout: 15000 })
  } finally { await browser?.close(); server.kill() }
})
