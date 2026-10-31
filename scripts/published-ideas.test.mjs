import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { readPublishedIdea } from '../packages/server/src/published-ideas.ts'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Pool } = require('pg')

test('an idle database client error is handled and the pool remains usable', async (t) => {
  let pool
  t.mock.method(Pool.prototype, 'query', function () {
    pool = this
    return Promise.resolve({ rows: [{ title: 'Title', description: 'Description' }] })
  })
  const log = t.mock.method(console, 'error', () => {})
  const expected = { title: 'Title', description: 'Description' }
  assert.deepEqual(await readPublishedIdea('postgres://example.invalid/test', 'idea'), expected)

  const error = new Error('idle connection lost')
  pool.emit('error', error)
  assert.equal(log.mock.callCount(), 1)
  assert.equal(log.mock.calls[0].arguments[1], error)
  assert.deepEqual(await readPublishedIdea('postgres://example.invalid/test', 'idea'), expected)
})

