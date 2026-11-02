import pg from 'pg'
import type { DeliveryEventStore } from './resend.js'

const stores = new Map<string, DeliveryEventStore>()

/** Create a store using the supplied pool; the caller owns its lifecycle. */
export function createDeliveryEventStore(pool: pg.Pool): DeliveryEventStore {
  return {
    async insert(event) {
      const result = await pool.query(`
        INSERT INTO email_delivery_events (event_id, email_id, event_type, occurred_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `, [event.eventId, event.emailId, event.type, event.occurredAt])
      return result.rowCount === 1 ? 'inserted' : 'duplicate'
    },
  }
}

/** Reuse a small pool for a configured server database. */
export function deliveryEventStore(databaseUrl: string): DeliveryEventStore {
  let store = stores.get(databaseUrl)
  if (!store) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 })
    pool.on('error', () => console.error('Unexpected error on idle delivery database client'))
    store = createDeliveryEventStore(pool)
    stores.set(databaseUrl, store)
  }
  return store
}
