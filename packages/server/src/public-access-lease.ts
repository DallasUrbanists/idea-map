import type pg from 'pg'
import { runtimeDatabasePool } from './runtime-database.js'

// Transaction-scoped locks work with transaction pooling. Every guarded reader
// and removal writer must use this same namespace before this can be relied on.
const sharedLock = 'SELECT pg_catalog.pg_advisory_xact_lock_shared(726421, 391)'

export type PublicAccessLease = {
  client: pg.PoolClient
  signal: AbortSignal
  release: () => Promise<void>
}

/**
 * Acquire the database portion of a public-read guard. The caller must stop
 * delivery if the connection fails and hold the lease until delivery finishes.
 * The primitive alone is not a complete access gate.
 */
export async function acquirePublicAccessLease(pool: pg.Pool): Promise<PublicAccessLease> {
  let client: pg.PoolClient
  try { client = await pool.connect() } catch { throw new Error('Public access unavailable') }
  const controller = new AbortController()
  const abort = () => controller.abort()
  client.on('error', abort)
  client.on('end', abort)
  let releasePromise: Promise<void> | undefined
  const dispose = (destroy: boolean) => {
    client.removeListener('error', abort)
    client.removeListener('end', abort)
    client.release(destroy)
  }
  try {
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    await client.query(sharedLock)
    const result = await client.query<{ is_open: boolean }>('SELECT is_open FROM public.public_access_gate WHERE singleton = true')
    if (controller.signal.aborted || result.rows.length !== 1 || result.rows[0]?.is_open !== true) throw new Error('Public access unavailable')
    return {
      client,
      signal: controller.signal,
      release: () => {
        releasePromise ??= (async () => {
          try {
            if (controller.signal.aborted) throw new Error('Public access unavailable')
            // A disconnected response may leave asynchronous handlers running.
            // Mark the lease unusable before returning its client to the pool.
            controller.abort()
            await client.query('COMMIT')
            dispose(false)
          } catch {
            controller.abort()
            dispose(true)
            throw new Error('Public access unavailable')
          }
        })()
        return releasePromise
      },
    }
  } catch {
    controller.abort()
    try { await client.query('ROLLBACK'); dispose(false) } catch { dispose(true) }
    throw new Error('Public access unavailable')
  }
}

/** Use the existing bounded web pool for a public-read lease. */
export async function acquirePublicAccessLeaseForDatabase(databaseUrl: string): Promise<PublicAccessLease> {
  if (!databaseUrl) throw new Error('Public access unavailable')
  return acquirePublicAccessLease(runtimeDatabasePool(databaseUrl))
}
