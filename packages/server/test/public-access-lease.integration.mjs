import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import pg from 'pg'
import { acquirePublicAccessLease } from '../dist/public-access-lease.js'

const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://invalid.invalid/invalid')
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/idea_map_test_public_gate') {
  throw new Error('TEST_DATABASE_URL must name the local disposable public-gate test database')
}

test('public-read lease fails closed and blocks a gate writer until active readers finish', async () => {
  await assert.rejects(acquirePublicAccessLease({ connect: async () => { throw new Error('synthetic sensitive connection details') } }),
    error => error.message === 'Public access unavailable' && !error.message.includes('sensitive'))
  const pool = new pg.Pool({ connectionString: url.toString(), max: 6, connectionTimeoutMillis: 2000 })
  let first, second, writer, late
  try {
    const initial = await pool.query('SELECT is_open FROM public.public_access_gate WHERE singleton = true')
    assert.deepEqual(initial.rows, [{ is_open: false }])
    assert.equal((await pool.query("SELECT has_table_privilege('public', 'public.public_access_gate', 'SELECT') AS allowed")).rows[0].allowed, false)
    await assert.rejects(acquirePublicAccessLease(pool), /Public access unavailable/)
    await pool.query('UPDATE public.public_access_gate SET is_open = true WHERE singleton = true')
    first = await acquirePublicAccessLease(pool)
    second = await acquirePublicAccessLease(pool)
    writer = await pool.connect()
    await writer.query('BEGIN')
    await writer.query("SET LOCAL lock_timeout = '5s'")
    const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const closing = writer.query('SELECT pg_advisory_xact_lock(726421, 391)')
    closing.catch(() => {})
    let waiting = false
    for (let attempt = 0; attempt < 50; attempt++) {
      waiting = (await pool.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting', [pid])).rows[0].waiting
      if (waiting) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(waiting, true)
    late = acquirePublicAccessLease(pool)
    late.catch(() => {})
    const releasing = first.release()
    assert.equal(first.release(), releasing)
    await releasing
    await second.release()
    await closing
    await writer.query('UPDATE public.public_access_gate SET is_open = false WHERE singleton = true')
    await writer.query('COMMIT')
    await assert.rejects(late, /Public access unavailable/)
    await first.release() // Cleanup is idempotent.
    await pool.query('DELETE FROM public.public_access_gate WHERE singleton = true')
    await assert.rejects(acquirePublicAccessLease(pool), /Public access unavailable/)
  } finally {
    await first?.release().catch(() => {})
    await second?.release().catch(() => {})
    if (writer) { await writer.query('ROLLBACK').catch(() => {}); writer.release() }
    if (late) await late.catch(() => {})
    await pool.query('INSERT INTO public.public_access_gate(singleton, is_open) VALUES (true, false) ON CONFLICT (singleton) DO UPDATE SET is_open = false')
    await pool.end()
  }
})

test('a lost database connection aborts the lease and prevents successful release', async () => {
  const pool = new pg.Pool({ connectionString: url.toString(), max: 3, connectionTimeoutMillis: 2000 })
  let lease
  try {
    await pool.query('UPDATE public.public_access_gate SET is_open = true WHERE singleton = true')
    lease = await acquirePublicAccessLease(pool)
    const pid = (await lease.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const aborted = once(lease.signal, 'abort')
    assert.equal((await pool.query('SELECT pg_terminate_backend($1) AS terminated', [pid])).rows[0].terminated, true)
    let timer
    try { await Promise.race([aborted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Lease did not abort')), 3000) })]) }
    finally { clearTimeout(timer) }
    assert.equal(lease.signal.aborted, true)
    await assert.rejects(lease.release(), /Public access unavailable/)
  } finally {
    await lease?.release().catch(() => {})
    await pool.query('UPDATE public.public_access_gate SET is_open = false WHERE singleton = true')
    await pool.end()
  }
})
