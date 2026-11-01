import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issueSession, SESSION_LIFETIME_MS } from '../apps/web/server/utils/session-policy.mjs'

const nowSeconds = 10000
const identity = { uid: 'alice', auth_time: nowSeconds, firebase: { sign_in_provider: 'password' } }
function provider(token = identity, session = identity) {
  return {
    async verifyIdToken(_token, checkRevoked) { assert.equal(checkRevoked, true); return token },
    async verifySessionCookie(_cookie, checkRevoked) { assert.equal(checkRevoked, true); return session },
    async createSessionCookie(_token, options) { assert.equal(options.expiresIn, SESSION_LIFETIME_MS); return 'signed-cookie' },
  }
}
test('issues bounded sessions for recent registered identities', async () => {
  assert.equal(await issueSession({ idToken: 'token', provider: provider(), nowSeconds }), 'signed-cookie')
  await assert.rejects(issueSession({ idToken: 'token', provider: provider({ ...identity, firebase: { sign_in_provider: 'anonymous' } }), nowSeconds }))
  await assert.rejects(issueSession({ idToken: 'token', provider: provider({ ...identity, auth_time: nowSeconds + 1 }), nowSeconds }))
})
test('renewal requires a verified existing session for the same registered user', async () => {
  const old = { ...identity, auth_time: nowSeconds - 301 }
  await assert.rejects(issueSession({ idToken: 'token', provider: provider(old), nowSeconds }))
  assert.equal(await issueSession({ idToken: 'token', existingCookie: 'cookie', provider: provider(old), nowSeconds }), 'signed-cookie')
  await assert.rejects(issueSession({ idToken: 'token', existingCookie: 'cookie', provider: provider(old, { ...identity, uid: 'bob' }), nowSeconds }))
  await assert.rejects(issueSession({ idToken: 'token', existingCookie: 'cookie', provider: provider(old, { ...identity, firebase: { sign_in_provider: 'anonymous' } }), nowSeconds }))
})
