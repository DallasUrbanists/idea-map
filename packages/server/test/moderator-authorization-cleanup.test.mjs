import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withVerifiedModerator } from '../dist/moderator-authorization.js'

const session = { uid: 'synthetic-moderator', email: 'moderator@example.invalid', email_verified: true,
  firebase: { sign_in_provider: 'password' } }
const verifier = { async verifySessionCookie() { return session },
  async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: false } } }

function poolWithFailures({ commitFails = false, rollbackFails = false } = {}) {
  const statements = []
  let released
  const client = { async query(sql) {
    statements.push(sql)
    if (sql === 'COMMIT' && commitFails) throw new Error('synthetic commit failure')
    if (sql === 'ROLLBACK' && rollbackFails) throw new Error('synthetic rollback failure')
    return { rows: sql.includes('lock_active_moderator') ? [{ user_id: 'synthetic-actor' }] : [] }
  }, release(destroy) { released = destroy } }
  return { pool: { async connect() { return client } }, statements, released: () => released }
}

test('a failed rollback discards the moderator connection without masking the action error', async () => {
  const fake = poolWithFailures({ rollbackFails: true })
  await assert.rejects(withVerifiedModerator('synthetic', 'demo-idea-map', 'synthetic-cookie', verifier,
    async () => { throw new Error('synthetic action failure') }, fake.pool), /synthetic action failure/)
  assert.equal(fake.statements.at(-1), 'ROLLBACK')
  assert.equal(fake.released(), true)
})

test('an uncertain commit remains an error after successful rollback', async () => {
  const fake = poolWithFailures({ commitFails: true })
  await assert.rejects(withVerifiedModerator('synthetic', 'demo-idea-map', 'synthetic-cookie', verifier,
    async () => 'synthetic result', fake.pool), /synthetic commit failure/)
  assert.deepEqual(fake.statements.slice(-2), ['COMMIT', 'ROLLBACK'])
  assert.equal(fake.released(), false)
})
