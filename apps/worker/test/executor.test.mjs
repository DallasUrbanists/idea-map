import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModerationExecutor } from '../dist/executor.js'

test('without an accepted policy, execution is unavailable without touching the database', async () => {
  const pool = { connect() { throw new Error('disabled executor must not connect') } }
  const execute = createModerationExecutor(pool)
  assert.equal(await execute('11111111-1111-4111-8111-111111111111'), 'unavailable')
})

test('the default job router does not query the database', async () => {
  const { createJobExecutor } = await import('../dist/job-router.js')
  const pool = { query() { throw new Error('disabled router must not query') } }
  assert.equal(await createJobExecutor(pool)('11111111-1111-4111-8111-111111111111'), 'unavailable')
})
