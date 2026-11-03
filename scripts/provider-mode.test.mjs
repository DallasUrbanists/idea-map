import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectProvider } from '../packages/server/dist/provider-mode.js'

test('provider modes are explicit, lazy and never fall back', async () => {
  let offlineCalls = 0, providerCalls = 0
  const failure = new Error('provider failed')
  const factories = { offline: () => { offlineCalls++; return { run: async () => 'offline' } },
    provider: () => { providerCalls++; return { run: async () => { throw failure } } } }
  for (const value of [undefined, '', 'invalid']) assert.throws(() => selectProvider(value, factories), /Choose provider mode/)
  assert.throws(() => selectProvider('offline', {}), /not available/)
  await assert.rejects(selectProvider('provider', factories).run(), error => error === failure)
  assert.equal(offlineCalls, 0)
  assert.equal(providerCalls, 1)
  assert.equal(await selectProvider('offline', factories).run(), 'offline')
  assert.equal(providerCalls, 1)
})
