import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { deliveryEventStore } from '../packages/server/dist/delivery-event-store.js'
import { getMediaPreview } from '../packages/server/dist/media-preview.js'
import { readPublishedIdea } from '../packages/server/dist/published-ideas.js'
import { runtimeDatabasePool } from '../packages/server/dist/runtime-database.js'

const url = process.env.TEST_DATABASE_URL
const parsed = url && new URL(url)
if (!parsed || parsed.hostname !== '127.0.0.1' || !parsed.pathname.startsWith('/idea_map_test_')) {
  throw new Error('TEST_DATABASE_URL must point to an isolated local idea_map_test_ database')
}

test('concurrent web database operations share the two-client limit', async () => {
  const pool = runtimeDatabasePool(url)
  const id = randomUUID()
  const event = { eventId: id, emailId: 'synthetic-email', type: 'email.sent', occurredAt: '2026-01-01T00:00:00Z' }
  const held = []
  let operations
  try {
    held.push(await pool.connect())
    held.push(await pool.connect())
    operations = Promise.all([
      readPublishedIdea(url, randomUUID()),
      getMediaPreview(url, 'synthetic-approved', randomUUID(), 1024),
      deliveryEventStore(url).insert(event),
    ])
    void operations.catch(() => {})
    for (let attempt = 0; attempt < 100 && pool.waitingCount < 3; attempt++) await delay(10)
    assert.equal(pool.totalCount, 2)
    assert.equal(pool.waitingCount, 3)
    while (held.length) held.pop().release()
    assert.deepEqual(await operations, [null, null, 'inserted'])
    assert.equal(pool.totalCount, 2)
  } finally {
    while (held.length) held.pop().release()
    if (operations) await operations.catch(() => {})
    await pool.query('DELETE FROM email_delivery_events WHERE event_id = $1', [id])
    await pool.end()
  }
})
