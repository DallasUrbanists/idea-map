import type pg from 'pg'
import { summarizeUnverifiedRecovery } from './recovery-journal-plan.js'
import { readUnverifiedRecoverySequence, type RecoverySequenceTransport } from './recovery-sequence-storage.js'
import { readUnverifiedSequenceRollover } from './recovery-sequence-rollover-storage.js'
import type { RolloverDescriptor } from './recovery-sequence-rollover.js'

/**
 * Suppress every known removal intent on an independently isolated restore.
 * This does not authenticate the inventory, prove coverage, restore holds,
 * update external projections, or authorize reopening public access.
 */
export async function suppressUnverifiedRestoredRemovals(pool: pg.Pool, records: Uint8Array[], environment: 'dev' | 'prod') {
  const summary = summarizeUnverifiedRecovery(records, environment)
  if (summary.removals.length > 10_000) throw new Error('Recovery suppression inventory is too large')
  let client: pg.PoolClient
  try { client = await pool.connect() } catch { throw new Error('Recovery suppression unavailable') }
  let destroy = false
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ matched: number, absent: number }>(
      'SELECT * FROM public.suppress_restored_removals($1::uuid[])', [summary.removals])
    const row = result.rows[0]
    if (result.rows.length !== 1 || !Number.isSafeInteger(row?.matched) || !Number.isSafeInteger(row?.absent) ||
        row!.matched < 0 || row!.absent < 0 || row!.matched + row!.absent !== summary.removals.length) {
      throw new Error('Recovery suppression result is ambiguous')
    }
    await client.query('COMMIT')
    return { matched: row!.matched, absent: row!.absent, reviewOperations: summary.reviewOperations.length,
      coverageVerified: false as const }
  } catch {
    try { await client.query('ROLLBACK') } catch { destroy = true }
    throw new Error('Recovery suppression outcome is uncertain')
  } finally { client.release(destroy) }
}

/**
 * Read exact numbered entries through a selected fence before suppression.
 * The caller must independently authenticate the baseline and fence, isolate
 * the restore, and stop all writers; this never proves coverage or opens access.
 */
export async function suppressKnownRemovalsFromSequence(reader: RecoverySequenceTransport,
  target: { environment: 'dev' | 'prod', epochId: string, projectNumber: string, secretId: string },
  fenceVersion: string, fenceNonce: string, pool: pg.Pool, timeoutMs = 120_000) {
  if (!target) throw new Error('Invalid recovery sequence target')
  const destination = { ...target }
  const inventory = await readUnverifiedRecoverySequence(reader, destination, fenceVersion, fenceNonce, timeoutMs)
  return suppressUnverifiedRestoredRemovals(pool, inventory.records.map(record => record.payload), destination.environment)
}

/**
 * Suppress known removals from two linked, independently isolated epochs.
 * Earlier epochs, writer coverage, the traffic fence and holds still require
 * independent verification. The timeout bounds journal reads, not the database.
 */
export async function suppressKnownRemovalsFromRollover(previousReader: RecoverySequenceTransport, previous: RolloverDescriptor,
  nextReader: RecoverySequenceTransport, next: RolloverDescriptor, pool: pg.Pool, timeoutMs = 120_000) {
  if (!previous || !next) throw new Error('Invalid rollover request')
  const old = { ...previous }, successor = { ...next }
  const inventory = await readUnverifiedSequenceRollover(previousReader, old, nextReader, successor, timeoutMs)
  const result = await suppressUnverifiedRestoredRemovals(pool, inventory.records.map(record => record.payload), old.environment)
  return { ...result, earlierEpochsIncluded: false as const }
}
