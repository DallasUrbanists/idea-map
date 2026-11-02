import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { readPublishedIdea } from '../packages/server/dist/published-ideas.js'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Pool } = require('pg')

test('published reads reuse a bounded pool after an idle client error', async (t) => {
  let pool
  t.mock.method(Pool.prototype, 'query', function () {
    pool = this
    return Promise.resolve({ rows: [{ title: 'Title', description: 'Description' }] })
  })
  const log = t.mock.method(console, 'error', () => {})
  const expected = { title: 'Title', description: 'Description' }
  assert.deepEqual(await readPublishedIdea('postgres://example.invalid/test', 'idea'), expected)
  assert.equal(pool.options.max, 2)
  const originalPool = pool

  const error = new Error('idle connection lost')
  pool.emit('error', error)
  assert.equal(log.mock.callCount(), 1)
  assert.deepEqual(log.mock.calls[0].arguments, ['Unexpected error on idle PostgreSQL client'])
  assert.deepEqual(await readPublishedIdea('postgres://example.invalid/test', 'idea'), expected)
  assert.equal(pool, originalPool)
})

