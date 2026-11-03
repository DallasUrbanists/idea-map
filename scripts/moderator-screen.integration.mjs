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
const { initializeApp, deleteApp } = webRequire('firebase-admin/app')
const { getAuth } = webRequire('firebase-admin/auth')
const { chromium } = webRequire('@playwright/test')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('browser, authenticated endpoints and database compose for private moderator holds and change requests', { timeout: 60000 }, async () => {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const priorEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  const app = initializeApp({ projectId: 'demo-idea-map' }, `review-screen-${port}`)
  const auth = getAuth(app)
  const pool = new pg.Pool({ connectionString: url })
  const role = `review_screen_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  let server
  let exited
  let browser
  let uid
  try {
    assert.equal((await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-idea-map/config')).status, 200)
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.list_moderator_queue(text,text,timestamptz,uuid), public.read_moderator_revision(text,text,uuid), public.apply_moderator_hold(text,text,text,uuid,text,uuid,text), public.apply_moderator_change_request(text,text,text,uuid,text,uuid,text) TO "${role}"`)
    const runtimeUrl = new URL(url)
    runtimeUrl.searchParams.set('options', `-c role=${role}`)
    server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_SESSION_ORIGIN: base,
        NUXT_FIREBASE_PROJECT_ID: 'demo-idea-map', NUXT_DATABASE_URL: runtimeUrl.toString(),
        NUXT_MODERATION_REVIEW_ENABLED: 'true', NUXT_MODERATION_ACTIONS_ENABLED: 'true' }, stdio: 'ignore',
    })
    exited = new Promise(resolve => server.once('exit', resolve))
    let ready = false
    for (let i = 0; i < 80 && !ready; i++) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error('Synthetic review server exited before startup')
      try { ready = (await fetch(`${base}/api/health`)).ok } catch { await delay(250) }
    }
    assert.ok(ready)
    const email = `review-screen-${port}@example.test`
    const password = 'synthetic-password-123'
    const requestAuth = (method, body) => fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const signup = await requestAuth('signUp', { email, password, returnSecureToken: true })
    assert.equal(signup.status, 200)
    uid = (await signup.json()).localId
    await auth.updateUser(uid, { emailVerified: true })
    const signin = await requestAuth('signInWithPassword', { email, password, returnSecureToken: true })
    assert.equal(signin.status, 200)
    const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession' }, body: JSON.stringify({ action: 'login', idToken: (await signin.json()).idToken }) })
    assert.equal(login.status, 200)
    const sessionCookie = login.headers.get('set-cookie').split(';')[0]
    const user = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map',$2)", [user, uid])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic') RETURNING id", [user])).rows[0].id
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('private-screen@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{\"text\":\"synthetic screen content\"}') RETURNING id", [idea])).rows[0].id
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {})
    const context = await browser.newContext({ baseURL: base })
    await context.addCookies([{ name: '__session', value: sessionCookie.slice('__session='.length), url: base, httpOnly: true, sameSite: 'Lax' }])
    const page = await context.newPage()
    await page.goto('/moderation')
    const open = () => page.getByRole('button', { name: `Review revision ${revision}` }).click()
    const reason = () => page.getByLabel('Reason')
    const submit = () => page.getByRole('button', { name: 'Record action' }).click()
    const waitRecorded = () => page.getByText('Action recorded. Reload the revision to see its current state.').waitFor()
    await open()
    await page.getByText('synthetic screen content', { exact: false }).waitFor()
    assert.equal(await page.locator('main').innerText().then(value => value.includes('private-screen@example.invalid')), false)
    assert.equal(await page.getByRole('button', { name: /approve/i }).count(), 0)
    await reason().fill('Synthetic review hold')
    await submit()
    await waitRecorded()
    await open()
    await page.getByLabel('Action').selectOption('release-hold')
    await page.getByLabel('Hold to release').selectOption({ label: 'hold: Synthetic review hold' })
    await reason().fill('Synthetic hold resolved')
    await submit()
    await waitRecorded()
    await open()
    await page.getByLabel('Action').selectOption('request-changes')
    await reason().fill('Synthetic requested change')
    await submit()
    await waitRecorded()
    await open()
    await page.getByLabel('Action').selectOption('resolve-changes')
    await page.getByLabel('Change request to resolve').selectOption({ label: 'Synthetic requested change' })
    await reason().fill('Synthetic change resolved')
    await submit()
    await waitRecorded()
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1 AND released_at IS NULL', [revision])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_requests WHERE idea_id=$1 AND resolved_at IS NULL', [idea])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [idea])).rows[0].publication_state, 'private')
    await open()
    await page.getByText('synthetic screen content', { exact: false }).waitFor()
    await pool.query("UPDATE moderator_assignments SET revoked_at=clock_timestamp(),revoked_by=$1,revoke_reason='synthetic revocation' WHERE id=$2", [user, assignment])
    await page.getByRole('button', { name: 'Refresh queue' }).click()
    await page.getByText('Your account does not currently have moderator access.').waitFor()
    assert.equal(await page.locator('pre').count(), 0)
    await context.close()
  } finally {
    if (browser) await browser.close()
    if (server && server.exitCode === null && server.signalCode === null) server.kill()
    if (exited) await exited
    if (uid) await auth.deleteUser(uid)
    await deleteApp(app)
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
    if (priorEmulator === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = priorEmulator
  }
})
