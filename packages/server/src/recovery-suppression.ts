import type pg from 'pg'
import { summarizeUnverifiedRecovery } from './recovery-journal-plan.js'
import { readUnverifiedRecoverySequence, type RecoverySequenceTransport } from './recovery-sequence-storage.js'
import { readUnverifiedSequenceChain, readUnverifiedSequenceRollover, type SequenceReaderEpoch } from './recovery-sequence-rollover-storage.js'
import type { RolloverDescriptor } from './recovery-sequence-rollover.js'

type IdeaCounts = { matched: number, absent: number }
type RecoverySummary = ReturnType<typeof summarizeUnverifiedRecovery>

function requireCounts(rows: IdeaCounts[], expected: number): IdeaCounts {
  const [row] = rows
  if (rows.length !== 1 || !row || !Number.isSafeInteger(row.matched) || !Number.isSafeInteger(row.absent) ||
      row.matched < 0 || row.absent < 0 || row.matched + row.absent !== expected) {
    throw new Error('Recovery result is ambiguous')
  }
  return { matched: row.matched, absent: row.absent }
}

async function updateRecoveredIdeas(pool: pg.Pool, summary: RecoverySummary, recoveryClosureId?: string) {
  if (summary.removals.length > 10_000 || (recoveryClosureId && summary.holdReviewIdeas.length > 10_000)) {
    throw new Error('Recovery suppression inventory is too large')
  }
  let client: pg.PoolClient
  try { client = await pool.connect() } catch { throw new Error('Recovery suppression unavailable') }
  let destroy = false
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const suppressed = await client.query<IdeaCounts>(
      'SELECT * FROM public.suppress_restored_removals($1::uuid[])', [summary.removals])
    const removals = requireCounts(suppressed.rows, summary.removals.length)
    let holds: IdeaCounts | undefined
    if (recoveryClosureId) {
      const protectedIdeas = await client.query<IdeaCounts>(
        'SELECT * FROM public.protect_restored_held_ideas($1::uuid,$2::uuid[])', [recoveryClosureId, summary.holdReviewIdeas])
      holds = requireCounts(protectedIdeas.rows, summary.holdReviewIdeas.length)
    }
    await client.query('COMMIT')
    return { ...removals, reviewOperations: summary.reviewOperations.length, coverageVerified: false as const, ...(holds && { holds }) }
  } catch {
    try { await client.query('ROLLBACK') } catch { destroy = true }
    throw new Error('Recovery suppression outcome is uncertain')
  } finally { client.release(destroy) }
}

/** Suppress known removals on an independently isolated restore. */
export async function suppressUnverifiedRestoredRemovals(pool: pg.Pool, records: Uint8Array[], environment: 'dev' | 'prod') {
  return updateRecoveredIdeas(pool, summarizeUnverifiedRecovery(records, environment))
}

/**
 * Apply conservative protections using a separately reviewed checkpoint and
 * recovery closure. The caller must authenticate and fence every writer and
 * isolate the replacement. Unknown or missing material still requires review.
 */
export async function reconcileFencedRecoveryFromSequence(reader: RecoverySequenceTransport,
  target: Parameters<typeof readUnverifiedRecoverySequence>[1] & { checkpointDigest: string },
  fenceVersion: string, fenceNonce: string, pool: pg.Pool, recoveryClosureId: string, timeoutMs = 120_000) {
  if (typeof recoveryClosureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(recoveryClosureId) ||
      !target || !/^[0-9a-f]{64}$/.test(target.checkpointDigest)) throw new Error('Invalid recovery checkpoint')
  const destination = { ...target }
  const inventory = await readUnverifiedRecoverySequence(reader, destination, fenceVersion, fenceNonce, timeoutMs)
  if (inventory.checkpointDigest !== destination.checkpointDigest) throw new Error('Recovery checkpoint differs')
  return updateRecoveredIdeas(pool, inventory.summary, recoveryClosureId)
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

/** Suppress only the supplied chain's known removals on an independently isolated restore. */
export async function suppressKnownRemovalsFromSequenceChain(epochs: SequenceReaderEpoch[], pool: pg.Pool, timeoutMs = 120_000) {
  const environment = epochs?.[0]?.descriptor?.environment
  if (environment !== 'dev' && environment !== 'prod') throw new Error('Invalid rollover request')
  const inventory = await readUnverifiedSequenceChain(epochs, timeoutMs)
  const result = await suppressUnverifiedRestoredRemovals(pool, inventory.records.map(record => record.payload), environment)
  return { ...result, epochCount: inventory.epochCount, earlierEpochsIncluded: false as const }
}
