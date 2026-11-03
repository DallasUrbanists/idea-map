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

test('moderator review and actions verify emulator sessions, authorization and request origin', { timeout: 30000 }, async () => {
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
    await pool.query(`GRANT EXECUTE ON FUNCTION public.read_moderator_revision(text,text,uuid) TO "${role}"`)
    await pool.query(`GRANT EXECUTE ON FUNCTION public.approve_moderation_revision(text,text,uuid,text,text), public.reject_moderation_revision(text,text,uuid,text,text), public.apply_moderator_change_request(text,text,text,uuid,text,uuid,text), public.request_moderator_changes_once(text,text,uuid,text,text,text) TO "${role}"`)
    await pool.query(`GRANT EXECUTE ON FUNCTION public.apply_moderator_hold(text,text,text,uuid,text,uuid,text), public.place_moderator_hold_once(text,text,uuid,text,text,text) TO "${role}"`)
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('private-contact@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{\"text\":\"synthetic pending content\"}') RETURNING id", [idea])).rows[0].id
    const runtimeUrl = new URL(url)
    runtimeUrl.searchParams.set('options', `-c role=${role}`)
    server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_SESSION_ORIGIN: base,
        NUXT_FIREBASE_PROJECT_ID: project, NUXT_DATABASE_URL: runtimeUrl.toString(), NUXT_MODERATION_REVIEW_ENABLED: 'true', NUXT_MODERATION_ACTIONS_ENABLED: 'true' }, stdio: 'ignore',
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
    const review = (id = revision, value = cookie) => fetch(`${base}/api/moderation/revisions/${id}`, { headers: { cookie: value } })
    const action = (body, value = cookie, origin = base, extra = {}) => fetch(`${base}/api/moderation/actions`, {
      method: 'POST', headers: { cookie: value, origin, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession', ...extra }, body: JSON.stringify(body),
    })
    const decision = { action: 'approve', revisionId: revision, assessmentId: null, reason: 'synthetic review' }
    assert.equal((await status('__session=forged')).status, 401)
    assert.equal((await status()).status, 403)
    assert.equal((await review(revision, '__session=forged')).status, 401)
    assert.equal((await review()).status, 403)
    assert.equal((await action(decision, '__session=forged')).status, 401)
    assert.equal((await action(decision)).status, 403)
    assert.equal((await action(decision, cookie, 'https://attacker.example')).status, 403)
    assert.equal((await action(decision, cookie, base, { 'x-idea-map-session': '' })).status, 403)
    assert.equal((await action(decision, cookie, base, { 'x-http-method-override': 'DELETE' })).status, 403)
    assert.equal((await action({ ...decision, actorId: 'forged' })).status, 400)
    assert.equal((await action({ ...decision, reason: 'x'.repeat(1001) })).status, 400)
    assert.equal((await action({ ...decision, reason: 'x'.repeat(5000) })).status, 413)
    assert.equal((await fetch(`${base}/api/moderation/status`, { headers: { cookie, 'x-role': 'moderator', 'x-user-id': 'forged' } })).status, 403)
    const user = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const actor = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map',$2)", [user, uid])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$2,'synthetic grant') RETURNING id", [user, actor])).rows[0].id
    const allowed = await status()
    assert.equal(allowed.status, 200)
    assert.match(allowed.headers.get('cache-control'), /private.*no-store/)
    assert.deepEqual(await allowed.json(), { moderator: true })
    const privateReview = await review()
    assert.equal(privateReview.status, 200)
    assert.match(privateReview.headers.get('cache-control'), /private.*no-store/)
    const reviewed = await privateReview.text()
    assert.equal(reviewed.includes('private-contact@example.invalid'), false)
    assert.deepEqual(JSON.parse(reviewed).content, { text: 'synthetic pending content' })
    const next = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{\"text\":\"new synthetic content\"}') RETURNING id", [idea])).rows[0].id
    assert.equal((await review()).status, 404)
    assert.deepEqual((await (await review(next)).json()).content, { text: 'new synthetic content' })
    const nextDecision = { ...decision, revisionId: next }
    const holdDecision = { ...nextDecision, action: 'place-hold', operationKey: 'web-hold-decision' }
    assert.equal((await action({ ...nextDecision, action: 'place-hold' })).status, 400)
    for (const operationKey of ['', 'x'.repeat(129), 'invalid key', 'line\n']) {
      assert.equal((await action({ ...holdDecision, operationKey })).status, 400)
    }
    const holdPlacements = await Promise.all([action(holdDecision), action(holdDecision)])
    for (const placement of holdPlacements) {
      assert.equal(placement.status, 200)
      assert.deepEqual(await placement.json(), { outcome: 'placed' })
    }
    assert.equal((await (await review(next)).json()).activeHoldCount, 1)
    assert.equal((await action(nextDecision)).status, 409)
    const holdId = (await pool.query('SELECT id FROM moderator_holds WHERE revision_id=$1 AND released_at IS NULL', [next])).rows[0].id
    assert.equal((await action({ ...nextDecision, action: 'release-hold', holdId })).status, 200)
    assert.equal((await action({ ...nextDecision, action: 'release-hold', holdId })).status, 409)
    const holdRetry = await action(holdDecision)
    assert.equal(holdRetry.status, 200)
    assert.deepEqual(await holdRetry.json(), { outcome: 'placed' })
    assert.equal((await action({ ...holdDecision, reason: 'different hold decision' })).status, 409)
    assert.equal((await (await review(next)).json()).activeHoldCount, 0)
    const changeDecision = { ...nextDecision, action: 'request-changes', operationKey: holdDecision.operationKey }
    assert.equal((await action({ ...nextDecision, action: 'request-changes' })).status, 400)
    for (const operationKey of ['', 'x'.repeat(129), 'invalid key', 'line\n']) {
      assert.equal((await action({ ...changeDecision, operationKey })).status, 400)
    }
    assert.equal((await action(changeDecision)).status, 200)
    const blocked = await action(nextDecision)
    assert.equal(blocked.status, 409)
    assert.match(blocked.headers.get('cache-control'), /private.*no-store/)
    assert.deepEqual(await blocked.json(), { outcome: 'blocked' })
    const requestId = (await pool.query('SELECT id FROM moderator_change_requests WHERE idea_id=$1 AND resolved_at IS NULL', [idea])).rows[0].id
    assert.equal((await action({ ...nextDecision, action: 'resolve-changes', requestId })).status, 200)
    const retried = await action(changeDecision)
    assert.equal(retried.status, 200)
    assert.deepEqual(await retried.json(), { outcome: 'requested' })
    assert.equal((await action({ ...changeDecision, reason: 'changed payload' })).status, 409)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_requests WHERE idea_id=$1 AND resolved_at IS NULL', [idea])).rows[0].n, 0)
    const approved = await action(nextDecision)
    assert.equal(approved.status, 200)
    assert.deepEqual(await approved.json(), { outcome: 'approved' })
    assert.equal((await action(nextDecision)).status, 409)
    const otherIdea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const otherRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [otherIdea])).rows[0].id
    assert.equal((await action({ ...nextDecision, action: 'reject', revisionId: otherRevision })).status, 200)
    assert.equal((await pool.query('SELECT review_state FROM idea_revisions WHERE id=$1', [otherRevision])).rows[0].review_state, 'rejected')
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
    assert.equal((await review(next)).status, 403)
    assert.equal((await action({ ...nextDecision, revisionId: otherRevision })).status, 403)
    assert.equal((await action(changeDecision)).status, 403)
    assert.equal((await action(holdDecision)).status, 403)
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
