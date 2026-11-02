import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_') || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL must name a migrated local disposable database beginning idea_map_test_')
}
const serverRequire = createRequire(new URL('../packages/server/package.json', import.meta.url))
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const pg = serverRequire('pg')
const { chromium } = webRequire('@playwright/test')
const { issueGuestVerification } = await import('../packages/server/dist/guest-verification.js')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('guest verification uses a fragment and explicit action without exposing the email or granting ownership', { timeout: 60000 }, async () => {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const pool = new pg.Pool({ connectionString: url })
  const role = `guest_page_test_${randomBytes(8).toString('hex')}`
  const key = randomBytes(32)
  let roleCreated = false
  let server
  let exited
  let browser
  try {
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_guest_verification(uuid,text), public.consume_guest_verification(uuid,text,text) TO "${role}"`)
    const runtimeUrl = new URL(url)
    runtimeUrl.searchParams.set('options', `-c role=${role}`)
    server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
      NUXT_SESSION_ORIGIN: base, NUXT_DATABASE_URL: runtimeUrl.toString(), NUXT_GUEST_VERIFICATION_ENABLED: 'true',
      NUXT_GUEST_VERIFICATION_KEY: key.toString('base64url') }, stdio: 'ignore' })
    exited = new Promise(resolve => server.once('exit', resolve))
    let ready = false
    for (let i = 0; i < 80 && !ready; i++) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error('Synthetic guest server exited before startup')
      try { ready = (await fetch(`${base}/api/health`)).ok } catch { await delay(250) }
    }
    assert.ok(ready)
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('private-guest@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const issued = await issueGuestVerification(pool, idea, key, 600, async () => true)
    assert.equal(issued.state, 'issued')
    const action = (body, origin = base, extra = {}) => fetch(`${base}/api/guest/verify`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession', ...extra }, body: JSON.stringify(body) })
    assert.equal((await action({ token: issued.token }, 'https://attacker.example')).status, 403)
    assert.equal((await action({ token: issued.token }, base, { 'x-idea-map-session': '' })).status, 403)
    assert.equal((await action({ token: issued.token }, base, { 'x-http-method-override': 'DELETE' })).status, 403)
    assert.equal((await action({ token: issued.token, ideaId: idea })).status, 400)
    assert.equal((await action({ token: 'x'.repeat(2000) })).status, 413)
    assert.equal((await pool.query('SELECT verified_at FROM contacts WHERE id=$1', [contact])).rows[0].verified_at, null)
    const restricted = new pg.Pool({ connectionString: runtimeUrl.toString() })
    try { await assert.rejects(restricted.query('SELECT * FROM contacts'), { code: '42501' }) } finally { await restricted.end() }
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {})
    const context = await browser.newContext({ baseURL: base })
    const page = await context.newPage()
    const requestUrls = []
    page.on('request', request => requestUrls.push(request.url()))
    const response = await page.goto(`/guest/verify#${issued.token}`)
    const html = await response.text()
    assert.equal(html.includes(issued.token), false)
    assert.equal(html.includes(key.toString('base64url')), false)
    assert.match(response.headers()['content-security-policy'], /default-src 'none'/)
    assert.equal(response.headers()['referrer-policy'], 'no-referrer')
    assert.match(response.headers()['cache-control'], /private.*no-store/)
    assert.equal(await page.locator('script[src]').count(), 0)
    await page.evaluate(() => { const injected = document.createElement('script'); injected.textContent = 'window.syntheticGuestInjection = true'; document.head.append(injected) })
    assert.equal(await page.evaluate(() => window.syntheticGuestInjection), undefined)
    await page.getByRole('button', { name: 'Verify email' }).waitFor()
    assert.equal(new URL(page.url()).hash, '')
    assert.equal(requestUrls.some(value => value.includes(issued.token)), false)
    assert.equal((await pool.query('SELECT verified_at FROM contacts WHERE id=$1', [contact])).rows[0].verified_at, null)
    await page.getByRole('button', { name: 'Verify email' }).click()
    await page.getByText('Your email has been verified.').waitFor()
    const verified = (await pool.query('SELECT c.verified_at,i.owner_id,i.publication_state FROM ideas i JOIN contacts c ON c.id=i.author_contact_id WHERE i.id=$1', [idea])).rows[0]
    assert.ok(verified.verified_at instanceof Date)
    assert.equal(verified.owner_id, null)
    assert.equal(verified.publication_state, 'private')
    const replay = await action({ token: issued.token })
    assert.equal(replay.status, 200)
    assert.match(replay.headers.get('cache-control'), /private.*no-store/)
    assert.deepEqual(await replay.json(), { verified: false })
    const invalid = await action({ token: 'invalid' })
    assert.equal(invalid.status, 200)
    assert.deepEqual(await invalid.json(), { verified: false })
    await context.close()
  } finally {
    if (browser) await browser.close()
    if (server && server.exitCode === null && server.signalCode === null) server.kill()
    if (exited) await exited
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
