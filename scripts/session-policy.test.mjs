import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issueSession, SESSION_LIFETIME_MS } from '../apps/web/server/utils/session-policy.mjs'

const nowSeconds = 10000
const identity = { uid: 'alice', iat: nowSeconds, auth_time: 100, firebase: { sign_in_provider: 'password' } }
function provider(token = identity) {
  return {
    async verifyIdToken(_token, checkRevoked) { assert.equal(checkRevoked, true); return token },
    async createSessionCookie(_token, options) { assert.equal(options.expiresIn, SESSION_LIFETIME_MS); return 'signed-cookie' },
  }
}
test('issues a bounded session from a freshly minted registered token even after an old sign-in', async () => {
  assert.equal(await issueSession({ idToken: 'token', provider: provider(), nowSeconds }), 'signed-cookie')
  for (const invalid of [
    { ...identity, firebase: { sign_in_provider: 'anonymous' } },
    { ...identity, firebase: {} }, { ...identity, iat: nowSeconds + 1 },
    { ...identity, iat: nowSeconds - 301 }, { ...identity, iat: undefined },
  ]) await assert.rejects(issueSession({ idToken: 'token', provider: provider(invalid), nowSeconds }))
  await assert.rejects(issueSession({ idToken: 'token', provider: { verifyIdToken() { throw new Error('revoked') } }, nowSeconds }))
})
