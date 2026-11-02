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
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('moderator status verifies emulator sessions and current database roles', { timeout: 30000 }, async () => {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const project = 'demo-idea-map'
  const priorEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  const app = initializeApp({ projectId: project }, `moderator-test-${port}`)
  const auth = getAuth(app)
  const pool = new pg.Pool({ connectionString: url })
  const role = `moderator_web_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  let server
  let exited
  let uid
  try {
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text) TO "${role}"`)
    const runtimeUrl = new URL(url)
    runtimeUrl.searchParams.set('options', `-c role=${role}`)
    server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_SESSION_ORIGIN: base,
        NUXT_FIREBASE_PROJECT_ID: project, NUXT_DATABASE_URL: runtimeUrl.toString() }, stdio: 'ignore',
    })
    exited = new Promise(resolve => server.once('exit', resolve))
    let ready = false
    for (let i = 0; i < 80 && !ready; i++) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`server exited (code ${server.exitCode}, signal ${server.signalCode})`)
      try { ready = (await fetch(`${base}/api/health`)).ok } catch { await delay(250) }
    }
    assert.ok(ready)
    const email = `moderator-${port}@example.test`
    const password = 'synthetic-password-123'
    const requestAuth = (method, body) => fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const signup = await requestAuth('signUp', { email, password, returnSecureToken: true })
    assert.equal(signup.status, 200)
    const created = await signup.json()
    uid = created.localId
    const loginWith = async idToken => fetch(`${base}/api/session`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession' }, body: JSON.stringify({ action: 'login', idToken }) })
    const unverifiedLogin = await loginWith(created.idToken)
    assert.equal(unverifiedLogin.status, 200)
    assert.equal((await fetch(`${base}/api/moderation/status`, { headers: { cookie: unverifiedLogin.headers.get('set-cookie').split(';')[0] } })).status, 403)
    await auth.updateUser(uid, { emailVerified: true })
    const signin = await requestAuth('signInWithPassword', { email, password, returnSecureToken: true })
    assert.equal(signin.status, 200)
    const { idToken } = await signin.json()
    const login = await loginWith(idToken)
    assert.equal(login.status, 200)
    let cookie = login.headers.get('set-cookie').split(';')[0]
    const status = (value = cookie) => fetch(`${base}/api/moderation/status`, { headers: { cookie: value } })
    assert.equal((await status('__session=forged')).status, 401)
    assert.equal((await status()).status, 403)
    assert.equal((await fetch(`${base}/api/moderation/status`, { headers: { cookie, 'x-role': 'moderator', 'x-user-id': 'forged' } })).status, 403)
    const user = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const actor = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map',$2)", [user, uid])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$2,'synthetic grant') RETURNING id", [user, actor])).rows[0].id
    const allowed = await status()
    assert.equal(allowed.status, 200)
    assert.match(allowed.headers.get('cache-control'), /private.*no-store/)
    assert.deepEqual(await allowed.json(), { moderator: true })
    assert.equal((await fetch(`${base}/api/moderation/status`, { method: 'POST', headers: { cookie } })).status, 403)
    await auth.updateUser(uid, { emailVerified: false })
    assert.ok([401, 403].includes((await status()).status))
    await auth.updateUser(uid, { emailVerified: true })
    await auth.updateUser(uid, { email: `changed-${port}@example.test`, emailVerified: true })
    assert.ok([401, 403].includes((await status()).status))
    await auth.updateUser(uid, { email, emailVerified: true })
    const refreshed = await requestAuth('signInWithPassword', { email, password, returnSecureToken: true })
    assert.equal(refreshed.status, 200)
    const renewed = await loginWith((await refreshed.json()).idToken)
    assert.equal(renewed.status, 200)
    cookie = renewed.headers.get('set-cookie').split(';')[0]
    assert.equal((await status()).status, 200)
    await pool.query("UPDATE moderator_assignments SET revoked_at=now(), revoked_by=$2, revoke_reason='synthetic revocation' WHERE id=$1", [assignment, actor])
    assert.equal((await status()).status, 403)
    await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$2,'synthetic regrant')", [user, actor])
    await auth.updateUser(uid, { disabled: true })
    assert.equal((await status()).status, 401)
  } finally {
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
