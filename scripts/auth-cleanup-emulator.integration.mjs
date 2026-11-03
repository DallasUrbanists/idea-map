import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackAuthTestAccounts } from './auth-emulator-accounts.mjs'

const endpoint = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:'
const post = (action, body) => fetch(`${endpoint}${action}?key=fake-key`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

// Use a disposable demo-idea-map Auth emulator on 9099, never a hosted project.
test('account cleanup removes only tracked emulator accounts', async () => {
  const owned = trackAuthTestAccounts()
  const unrelated = trackAuthTestAccounts()
  const makeAccount = async (tracker, label) => {
    const response = await post('signUp', { email: `${label}-${randomUUID()}@example.test`,
      password: 'synthetic-password', returnSecureToken: true })
    assert.equal(response.status, 200)
    const { idToken } = await response.json()
    tracker.add(label, idToken)
    return idToken
  }
  try {
    const sentinel = await makeAccount(unrelated, 'sentinel')
    const first = await makeAccount(owned, 'first')
    const second = await makeAccount(owned, 'second')
    for (const idToken of [sentinel, first, second]) assert.equal((await post('lookup', { idToken })).status, 200)
    await owned.cleanup()
    assert.equal((await post('lookup', { idToken: sentinel })).status, 200)
    for (const idToken of [first, second]) assert.equal((await post('lookup', { idToken })).status, 400)
    await owned.cleanup()
  } finally {
    const results = await Promise.allSettled([owned.cleanup(), unrelated.cleanup()])
    if (results.some(result => result.status === 'rejected')) throw new Error('Auth cleanup integration could not remove its test accounts')
  }
})
