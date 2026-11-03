import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackAuthTestAccounts } from './auth-emulator-accounts.mjs'

test('cleanup deletes only tracked accounts and reports failures after attempting each', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    return { ok: requests.length !== 1 }
  })
  const accounts = trackAuthTestAccounts()
  accounts.add('first', 'old-token')
  accounts.add('first', 'current-token')
  accounts.add('second', 'other-token')
  await assert.rejects(accounts.cleanup(), /Failed to delete 1/)
  assert.deepEqual(requests.map(request => request.body), [{ idToken: 'current-token' }, { idToken: 'other-token' }])
  assert.ok(requests.every(request => request.url === 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=fake-key'))
  assert.equal(accounts.size, 1)
  await accounts.cleanup()
  assert.equal(accounts.size, 0)
  assert.deepEqual(requests[2].body, { idToken: 'current-token' })
  await accounts.cleanup()
  assert.equal(requests.length, 3)
})
