import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { withVerifiedModerator } from '../dist/moderator-authorization.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('verified moderator authorization locks current database role through the action', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 5 })
  const role = `moderator_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const actor = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator-subject')", [moderator])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$2,'synthetic grant') RETURNING id", [moderator, actor])).rows[0].id
    const session = { uid: 'moderator-subject', email: 'moderator@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } }
    const account = { uid: session.uid, email: session.email, emailVerified: true, disabled: false }
    const verify = { async verifySessionCookie(cookie, revoked) { assert.equal(cookie, 'synthetic-cookie'); assert.equal(revoked, true); return session }, async getUser() { return account } }
    const run = (provider = verify, project = 'demo-idea-map') => withVerifiedModerator(url, project, 'synthetic-cookie', provider, async (_, id) => id)
    assert.deepEqual(await run(), { state: 'authorized', value: moderator })
    await assert.rejects(pool.query("UPDATE moderator_assignments SET grant_reason='changed' WHERE id=$1", [assignment]), /Only revocation/)
    await assert.rejects(pool.query('DELETE FROM moderator_assignments WHERE id=$1', [assignment]), /cannot be deleted/)
    assert.deepEqual(await run(verify, 'other-project'), { state: 'forbidden' })
    assert.deepEqual(await run({ ...verify, async verifySessionCookie() { return { ...session, firebase: { sign_in_provider: 'anonymous' } } } }), { state: 'unauthenticated' })
    assert.deepEqual(await run({ ...verify, async verifySessionCookie() { return { ...session, email_verified: false } } }), { state: 'forbidden' })
    assert.deepEqual(await run({ ...verify, async getUser() { return { ...account, emailVerified: false } } }), { state: 'forbidden' })
    assert.deepEqual(await run({ ...verify, async getUser() { return { ...account, uid: 'other-subject' } } }), { state: 'unauthenticated' })
    assert.deepEqual(await run({ ...verify, async getUser() { return { ...account, disabled: true } } }), { state: 'unauthenticated' })
    assert.deepEqual(await run({ ...verify, async getUser() { return { ...account, email: 'changed@example.invalid' } } }), { state: 'forbidden' })
    assert.deepEqual(await run({ ...verify, async verifySessionCookie() { throw Object.assign(new Error('revoked'), { code: 'auth/session-cookie-revoked' }) } }), { state: 'unauthenticated' })
    await assert.rejects(run({ ...verify, async verifySessionCookie() { throw new Error('provider unavailable') } }), /Identity verification unavailable/)
    await assert.rejects(withVerifiedModerator(url, 'demo-idea-map', 'synthetic-cookie', verify, async () => { throw new Error('synthetic rollback') }), /synthetic rollback/)

    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.lock_active_moderator('firebase:demo-idea-map','moderator-subject')"), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      assert.equal((await limited.query("SELECT public.lock_active_moderator('firebase:demo-idea-map','moderator-subject') AS id")).rows[0].id, moderator)
      await assert.rejects(limited.query('SELECT * FROM moderator_assignments'), { code: '42501' })
      await assert.rejects(limited.query('UPDATE moderator_assignments SET revoked_at=now()'), { code: '42501' })
      await assert.rejects(limited.query('DELETE FROM moderator_assignments'), { code: '42501' })
      await assert.rejects(limited.query('TRUNCATE moderator_assignments'), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }

    let release
    let started
    const locked = new Promise(resolve => { started = resolve })
    const wait = new Promise(resolve => { release = resolve })
    const action = withVerifiedModerator(url, 'demo-idea-map', 'synthetic-cookie', verify, async () => { started(); await wait; return true })
    await locked
    const revoke = pool.query("UPDATE moderator_assignments SET revoked_by=$2, revoked_at=now(), revoke_reason='synthetic revocation' WHERE id=$1", [assignment, actor])
    try {
      assert.equal(await Promise.race([revoke.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]), false)
    } finally { release() }
    assert.deepEqual(await action, { state: 'authorized', value: true })
    await revoke
    assert.deepEqual(await run(), { state: 'forbidden' })
    await assert.rejects(pool.query('UPDATE moderator_assignments SET revoked_by=NULL, revoked_at=NULL, revoke_reason=NULL WHERE id=$1', [assignment]), /Only revocation/)
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
