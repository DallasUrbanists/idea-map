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
const pg = createRequire(new URL('../packages/server/package.json', import.meta.url))('pg')
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { initializeApp, deleteApp } = webRequire('firebase-admin/app')
const { getAuth } = webRequire('firebase-admin/auth')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('ownership claims require current verified identity and preserve private state', { timeout: 30000 }, async () => {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const priorEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  const app = initializeApp({ projectId: 'demo-idea-map' }, `ownership-test-${port}`)
  const auth = getAuth(app)
  const pool = new pg.Pool({ connectionString: url })
  const role = `ownership_web_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  let server
  let exited
  const uids = []
  try {
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await pool.query(`GRANT EXECUTE ON FUNCTION public.claim_verified_idea(text,text,text,uuid) TO "${role}"`)
    const runtimeUrl = new URL(url)
    runtimeUrl.searchParams.set('options', `-c role=${role}`)
    const start = async enabled => {
      const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_SESSION_ORIGIN: base,
        NUXT_AUTH_PROVIDER_MODE: 'offline', NUXT_FIREBASE_PROJECT_ID: 'demo-idea-map', NUXT_DATABASE_URL: runtimeUrl.toString() }
      delete env.NUXT_OWNERSHIP_CLAIMS_ENABLED
      if (enabled) env.NUXT_OWNERSHIP_CLAIMS_ENABLED = 'true'
      server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
        env, stdio: 'ignore',
      })
      exited = new Promise(resolve => server.once('exit', resolve))
      for (let i = 0; i < 80; i++) {
        if (server.exitCode !== null || server.signalCode !== null) throw new Error(`server exited (code ${server.exitCode}, signal ${server.signalCode})`)
        try { if ((await fetch(`${base}/api/health`)).ok) return } catch { /* still starting */ }
        await delay(250)
      }
      throw new Error('server did not start')
    }
    const stop = async () => { if (server && server.exitCode === null && server.signalCode === null) server.kill(); if (exited) await exited; server = null; exited = null }
    const post = (cookie, ideaId, extra = {}, body = { ideaId }) => fetch(`${base}/api/ownership/claim`, {
      method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession', ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body),
    })
    const missing = '11111111-1111-4111-8111-111111111111'
    await start(false)
    assert.equal((await post(null, missing)).status, 403)
    await stop()
    await start(true)
    const password = 'synthetic-password-123'
    const authRequest = (method, body) => fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const createAccount = async (email, verify) => {
      const signup = await authRequest('signUp', { email, password, returnSecureToken: true })
      assert.equal(signup.status, 200)
      const created = await signup.json()
      uids.push(created.localId)
      if (verify) await auth.updateUser(created.localId, { emailVerified: true })
      const signed = await authRequest('signInWithPassword', { email, password, returnSecureToken: true })
      assert.equal(signed.status, 200)
      const { idToken } = await signed.json()
      const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession' }, body: JSON.stringify({ action: 'login', idToken }) })
      assert.equal(login.status, 200)
      return { uid: created.localId, cookie: login.headers.get('set-cookie').split(';')[0] }
    }
    const email = `owner-${port}@example.test`
    const owner = await createAccount(email, true)
    const other = await createAccount(`other-${port}@example.test`, true)
    const unverified = await createAccount(`unverified-${port}@example.test`, false)
    const contact = (await pool.query('INSERT INTO contacts(normalized_email) VALUES ($1) RETURNING id', [email])).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    assert.equal((await post(null, idea)).status, 401)
    assert.equal((await post('__session=forged', idea)).status, 401)
    assert.equal((await post(unverified.cookie, idea)).status, 403)
    assert.equal((await post(owner.cookie, idea, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await post(owner.cookie, idea, { 'x-idea-map-session': '' })).status, 403)
    assert.equal((await post(owner.cookie, idea, { 'x-http-method-override': 'DELETE' })).status, 403)
    assert.equal((await post(owner.cookie, idea, {}, { ideaId: idea, userId: 'forged' })).status, 400)
    assert.equal((await post(owner.cookie, idea, {}, { ideaId: 'x'.repeat(5000) })).status, 413)
    assert.equal((await post(other.cookie, idea)).status, 204)
    assert.equal((await post(other.cookie, missing)).status, 204)
    assert.equal((await pool.query('SELECT owner_id FROM ideas WHERE id=$1', [idea])).rows[0].owner_id, null)
    await auth.updateUser(owner.uid, { email: `changed-${port}@example.test`, emailVerified: true })
    assert.ok([401, 403].includes((await post(owner.cookie, idea)).status))
    await auth.updateUser(owner.uid, { email, emailVerified: true })
    const renewedSignIn = await authRequest('signInWithPassword', { email, password, returnSecureToken: true })
    assert.equal(renewedSignIn.status, 200)
    const renewal = await fetch(`${base}/api/session`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession' }, body: JSON.stringify({ action: 'login', idToken: (await renewedSignIn.json()).idToken }) })
    assert.equal(renewal.status, 200)
    owner.cookie = renewal.headers.get('set-cookie').split(';')[0]
    const results = await Promise.all([post(owner.cookie, idea), post(owner.cookie, idea)])
    assert.deepEqual(results.map(response => response.status), [204, 204])
    for (const response of results) { assert.equal(await response.text(), ''); assert.match(response.headers.get('cache-control'), /private.*no-store/) }
    const ownerRow = (await pool.query('SELECT owner_id, publication_state FROM ideas WHERE id=$1', [idea])).rows[0]
    assert.ok(ownerRow.owner_id)
    assert.equal(ownerRow.publication_state, 'private')
    const evidence = (await pool.query('SELECT verified_identity_id,verified_at FROM ownership_claims WHERE idea_id=$1', [idea])).rows
    assert.equal(evidence.length, 1)
    assert.ok(evidence[0].verified_identity_id && evidence[0].verified_at)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE idea_id=$1 AND event_type='ownership_claimed'", [idea])).rows[0].n, 1)
    assert.equal((await pool.query('SELECT verified_at FROM contacts WHERE id=$1', [contact])).rows[0].verified_at, null)
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) server.kill()
    if (exited) await exited
    for (const uid of uids) await auth.deleteUser(uid)
    await deleteApp(app)
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
    if (priorEmulator === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = priorEmulator
  }
})
