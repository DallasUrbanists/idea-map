import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { readPublishedIdea } from '../packages/server/dist/published-ideas.js'
import { getMediaPreview } from '../packages/server/dist/media-preview.js'
import { deliveryEventStore } from '../packages/server/dist/delivery-event-store.js'

const { Pool } = createRequire(new URL('../packages/server/package.json', import.meta.url))('pg')

test('published reads, previews and delivery events share the two-client pool for each URL', async (t) => {
  const calls = []
  t.mock.method(Pool.prototype, 'query', function (sql) {
    calls.push({ pool: this, sql })
    if (sql.includes('INSERT INTO email_delivery_events')) return Promise.resolve({ rowCount: 1, rows: [] })
    if (sql.includes('FROM media_previews')) return Promise.resolve({ rows: [] })
    return Promise.resolve({ rows: [{ title: 'Title', description: 'Description' }] })
  })
  const url = 'postgres://example.invalid/pool-test'
  const results = await Promise.all([
    readPublishedIdea(url, 'idea'),
    getMediaPreview(url, 'synthetic-approved', 'preview', 1024),
    deliveryEventStore(url).insert({ eventId: 'event', emailId: 'email', type: 'email.sent', occurredAt: '2026-01-01T00:00:00Z' }),
  ])
  assert.deepEqual(results, [{ title: 'Title', description: 'Description' }, null, 'inserted'])
  assert.equal(calls.length, 3)
  const pool = calls[0].pool
  assert.equal(pool.options.max, 2)
  assert.ok(calls.every(call => call.pool === pool))

  await readPublishedIdea('postgres://example.invalid/other-pool', 'idea')
  assert.notEqual(calls[3].pool, pool)
  assert.equal(calls[3].pool.options.max, 2)
})
