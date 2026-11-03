import type pg from 'pg'
import { runtimeDatabasePool } from './runtime-database.js'

// Transaction-scoped locks work with transaction pooling. Every guarded reader
// and removal writer must use this same namespace before this can be relied on.
const sharedLock = 'SELECT pg_catalog.pg_advisory_xact_lock_shared(726421, 391)'
const accessStillValid = `SELECT (SELECT is_open FROM public.public_access_gate WHERE singleton = true) AS is_open, EXISTS (
  SELECT 1 FROM pg_catalog.pg_locks
  WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database())
    AND classid = 726421::oid AND objid = 391::oid AND objsubid = 2 AND mode = 'ExclusiveLock' AND NOT granted
) AS closing`

export type PublicAccessLease = {
  readonly signal: AbortSignal
  readonly release: () => Promise<void>
}

const activeLeases = new WeakMap<PublicAccessLease, pg.PoolClient>()

/** Keep the underlying connection private and reject inactive leases. */
export function publicAccessLeaseClient(value: PublicAccessLease | undefined): pg.PoolClient {
  const client = value && activeLeases.get(value)
  if (!value || !client || value.signal.aborted) throw new Error('Public access unavailable')
  return client
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
    let checking = false
    const timer = setInterval(() => {
      if (checking || controller.signal.aborted) return
      checking = true
      void client.query<{ is_open: boolean | null, closing: boolean }>(accessStillValid).then(status => {
        if (status.rows.length !== 1 || status.rows[0]?.is_open !== true || status.rows[0]?.closing !== false) controller.abort()
      }, () => controller.abort()).finally(() => { checking = false })
    }, 250)
    timer.unref()
    controller.signal.addEventListener('abort', () => clearInterval(timer), { once: true })
    const lease: PublicAccessLease = {
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
    activeLeases.set(lease, client)
    controller.signal.addEventListener('abort', () => activeLeases.delete(lease), { once: true })
    return Object.freeze(lease)
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
