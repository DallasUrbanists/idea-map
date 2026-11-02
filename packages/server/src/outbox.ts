import { randomUUID } from 'node:crypto'
import type pg from 'pg'

const MAX_DISPATCH_ATTEMPTS = 5
const LEASE_SECONDS = 300
const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000
const MAX_DISPATCH_TIMEOUT_MS = 240_000

export interface JobIntent {
  idempotencyKey: string
  kind: string
  revisionId?: string
  assessmentId?: string
  assessmentReceivedAt?: Date
  scheduledAt: Date
}

export interface DurableJob {
  id: string
  idempotencyKey: string
  kind: string
  revisionId: string | null
  assessmentId: string | null
  assessmentReceivedAt: Date | null
  scheduledAt: Date
}

/** A dispatcher must deduplicate by job.id and stop promptly when the signal is aborted. */
export interface JobDispatcher {
  dispatch(job: DurableJob, signal: AbortSignal): Promise<void>
}

export interface DispatchOptions { timeoutMs?: number }

function dispatchTimeout(options: DispatchOptions): number {
  const timeout = options.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_DISPATCH_TIMEOUT_MS) {
    throw new Error('Dispatch timeout must be between 1 and 240000 milliseconds')
  }
  return timeout
}

type JobRow = { id: string, idempotency_key: string, kind: string, revision_id: string | null,
  assessment_id: string | null, assessment_received_at: Date | null, scheduled_at: Date }

function jobFromRow(row: JobRow): DurableJob {
  return { id: row.id, idempotencyKey: row.idempotency_key, kind: row.kind, revisionId: row.revision_id,
    assessmentId: row.assessment_id, assessmentReceivedAt: row.assessment_received_at, scheduledAt: row.scheduled_at }
}

function validateIntent(intent: JobIntent): void {
  if (!intent.idempotencyKey.trim() || !intent.kind.trim() || !(intent.scheduledAt instanceof Date) || !Number.isFinite(intent.scheduledAt.getTime())) {
    throw new Error('Invalid job identity or schedule')
  }
  const hasAssessment = intent.assessmentId !== undefined || intent.assessmentReceivedAt !== undefined
  if (hasAssessment && (!intent.assessmentId?.trim() || !intent.revisionId || !(intent.assessmentReceivedAt instanceof Date) ||
    !Number.isFinite(intent.assessmentReceivedAt.getTime()) || intent.scheduledAt < intent.assessmentReceivedAt)) {
    throw new Error('Invalid assessment identity or schedule')
  }
}

/** Insert an immutable intent on an existing transaction. A duplicate never changes its schedule. */
export async function enqueueJob(client: pg.PoolClient, intent: JobIntent): Promise<{ job: DurableJob, inserted: boolean }> {
  validateIntent(intent)
  const values = [intent.idempotencyKey, intent.kind, intent.revisionId ?? null, intent.assessmentId ?? null,
    intent.assessmentReceivedAt ?? null, intent.scheduledAt]
  const inserted = await client.query<JobRow>(`
    INSERT INTO jobs (idempotency_key, kind, revision_id, assessment_id, assessment_received_at, scheduled_at)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, idempotency_key, kind, revision_id, assessment_id, assessment_received_at, scheduled_at`, values)
  if (inserted.rowCount) {
    const job = jobFromRow(inserted.rows[0])
    await client.query('INSERT INTO outbox (job_id) VALUES ($1)', [job.id])
    return { job, inserted: true }
  }
  const existing = await client.query<JobRow>(`
    SELECT id, idempotency_key, kind, revision_id, assessment_id, assessment_received_at, scheduled_at FROM jobs
    WHERE idempotency_key = $1 AND kind = $2 AND revision_id IS NOT DISTINCT FROM $3::uuid
      AND assessment_id IS NOT DISTINCT FROM $4::text AND assessment_received_at IS NOT DISTINCT FROM $5::timestamptz
      AND scheduled_at = $6::timestamptz`, values)
  if (!existing.rowCount) throw new Error('Job identity conflicts with an existing intent')
  return { job: jobFromRow(existing.rows[0]), inserted: false }
}

async function transaction<T>(pool: pg.Pool, body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await body(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Commit a new intent and its domain change together; duplicate requests do not repeat the change. */
export async function createJobIntent(pool: pg.Pool, intent: JobIntent,
  change: (client: pg.PoolClient, job: DurableJob) => Promise<void>): Promise<{ job: DurableJob, inserted: boolean }> {
  return transaction(pool, async client => {
    const result = await enqueueJob(client, intent)
    if (result.inserted) await change(client, result.job)
    return result
  })
}

type ClaimRow = JobRow & { lease_token: string }

async function claim(pool: pg.Pool, excluded: string[], jobId?: string): Promise<ClaimRow | null> {
  const token = randomUUID()
  const result = await pool.query<ClaimRow>(`
    WITH candidate AS (
      SELECT o.id FROM outbox o JOIN jobs j ON j.id = o.job_id
      WHERE o.published_at IS NULL AND o.dispatch_attempts < $1
        AND (o.lease_until IS NULL OR o.lease_until <= clock_timestamp())
        AND j.scheduled_at IS NOT NULL AND j.state = 'pending'
        AND NOT (j.id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR j.id = $3::uuid)
      ORDER BY o.created_at, o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1
    ), claimed AS (
      UPDATE outbox o SET lease_token = $4, lease_until = clock_timestamp() + ($5::int * interval '1 second'),
        dispatch_attempts = o.dispatch_attempts + 1 FROM candidate c WHERE o.id = c.id
      RETURNING o.job_id, o.lease_token
    ) SELECT j.id, j.idempotency_key, j.kind, j.revision_id, j.assessment_id, j.assessment_received_at, j.scheduled_at, c.lease_token
      FROM claimed c JOIN jobs j ON j.id = c.job_id`, [MAX_DISPATCH_ATTEMPTS, excluded, jobId ?? null, token, LEASE_SECONDS])
  return result.rows[0] ?? null
}

async function dispatchClaim(pool: pg.Pool, dispatcher: JobDispatcher, row: ClaimRow, timeoutMs: number): Promise<boolean> {
  let succeeded = false
  let acknowledged = false
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      dispatcher.dispatch(jobFromRow(row), controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('Job dispatch timed out'))
        }, timeoutMs)
      }),
    ])
    succeeded = true
  } finally {
    if (timer) clearTimeout(timer)
    // A timed-out claimant must never overwrite a newer lease or its result.
    const result = await pool.query(`UPDATE outbox SET published_at = CASE WHEN $3 THEN clock_timestamp() ELSE published_at END,
      lease_token = NULL, lease_until = NULL WHERE job_id = $1 AND lease_token = $2`, [row.id, row.lease_token, succeeded])
    acknowledged = result.rowCount === 1
  }
  return succeeded && acknowledged
}

/** Attempt one committed job; failures remain eligible for a later repair. */
export async function dispatchJob(pool: pg.Pool, dispatcher: JobDispatcher, jobId: string, options: DispatchOptions = {}): Promise<'dispatched' | 'unavailable'> {
  const timeout = dispatchTimeout(options)
  const row = await claim(pool, [], jobId)
  if (!row) return 'unavailable'
  return await dispatchClaim(pool, dispatcher, row, timeout) ? 'dispatched' : 'unavailable'
}

/** Run one bounded repair pass. A failed job is attempted at most once per pass. */
export async function reconcileOutbox(pool: pg.Pool, dispatcher: JobDispatcher, limit: number, options: DispatchOptions = {}): Promise<{ attempted: number, failed: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Repair limit must be between 1 and 100')
  const timeout = dispatchTimeout(options)
  const attempted: string[] = []
  let failed = 0
  while (attempted.length < limit) {
    const row = await claim(pool, attempted)
    if (!row) break
    attempted.push(row.id)
    try { if (!await dispatchClaim(pool, dispatcher, row, timeout)) failed++ } catch { failed++ }
  }
  return { attempted: attempted.length, failed }
}

/** Reset an exhausted unpublished intent after an operator has investigated delivery. */
export async function retryExhaustedDispatch(pool: pg.Pool, jobId: string): Promise<boolean> {
  const result = await pool.query(`UPDATE outbox SET dispatch_attempts = 0, lease_token = NULL, lease_until = NULL
    WHERE job_id = $1 AND published_at IS NULL AND dispatch_attempts = $2
      AND (lease_until IS NULL OR lease_until <= clock_timestamp())
      AND EXISTS (SELECT 1 FROM jobs WHERE id = outbox.job_id AND state = 'pending')`, [jobId, MAX_DISPATCH_ATTEMPTS])
  return result.rowCount === 1
}

/** Run database-only work once. The handler must lock and recheck domain eligibility before changing it. */
export async function executeJob(pool: pg.Pool, jobId: string,
  handler: (client: pg.PoolClient, job: DurableJob) => Promise<'completed' | 'stale'>): Promise<'completed' | 'stale' | 'duplicate' | 'not-due' | 'missing'> {
  return transaction(pool, async client => {
    const result = await client.query<JobRow & { state: string, due: boolean }>(`
      SELECT id, idempotency_key, kind, revision_id, assessment_id, assessment_received_at, scheduled_at, state,
        scheduled_at <= clock_timestamp() AS due FROM jobs WHERE id = $1 FOR UPDATE`, [jobId])
    const row = result.rows[0]
    if (!row || !row.scheduled_at) return 'missing'
    if (row.state === 'completed' || row.state === 'stale') return 'duplicate'
    if (row.state !== 'pending') throw new Error('Unknown job state')
    if (!row.due) return 'not-due'
    const state = await handler(client, jobFromRow(row))
    if (state !== 'completed' && state !== 'stale') throw new Error('Invalid job result')
    await client.query('UPDATE jobs SET state = $2, attempts = attempts + 1 WHERE id = $1', [jobId, state])
    return state
  })
}
