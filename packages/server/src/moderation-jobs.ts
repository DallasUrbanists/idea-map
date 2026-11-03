import type pg from 'pg'
import { dispatchJob, enqueueJob, executeJob, type DurableJob, type JobDispatcher } from './outbox.js'
import { recordApprovedSubmission } from './approval-history.js'

export interface AcceptedAssessment {
  id: string
  revisionId: string
  /** Digest of the complete validated assessment, never its private contents. */
  fingerprint: string
  /** Supplied by the approved policy; null requires human review. */
  waitMilliseconds: number | null
  shortcutRequested: boolean
}

/** The caller must validate complete assessment evidence before calling this server-only API. */
export async function recordAcceptedAssessment(pool: pg.Pool, input: AcceptedAssessment): Promise<{ inserted: boolean, receivedAt: Date, deadline: Date | null, jobIds: string[] }> {
  if (!input.id.trim() || input.id !== input.id.trim() || Buffer.byteLength(input.id, 'utf8') > 200 || !/^[a-f0-9]{64}$/.test(input.fingerprint) ||
    (input.waitMilliseconds !== null && (!Number.isInteger(input.waitMilliseconds) || input.waitMilliseconds < 0 || input.waitMilliseconds > 86_400_000)) ||
    (input.waitMilliseconds === null && input.shortcutRequested)) throw new Error('Invalid accepted assessment')
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    const revision = await client.query<{ idea_id: string }>(`SELECT r.idea_id FROM idea_revisions r
      JOIN ideas i ON i.id = r.idea_id WHERE r.id = $1 FOR UPDATE OF i, r`, [input.revisionId])
    if (!revision.rowCount) throw new Error('Revision not found')
    const existing = await client.query<{ revision_id: string, fingerprint: string, wait_milliseconds: number | null, shortcut_requested: boolean, received_at: Date, deadline: Date | null }>(
      'SELECT revision_id, fingerprint, wait_milliseconds, shortcut_requested, received_at, deadline FROM revision_assessments WHERE id = $1', [input.id])
    if (existing.rowCount) {
      const prior = existing.rows[0]
      if (prior.revision_id !== input.revisionId || prior.fingerprint !== input.fingerprint ||
        prior.wait_milliseconds !== input.waitMilliseconds || prior.shortcut_requested !== input.shortcutRequested) throw new Error('Assessment identity conflicts with existing evidence')
      const jobs = await client.query<{ id: string }>("SELECT id FROM jobs WHERE revision_id = $1 AND assessment_id = $2 AND kind IN ('moderation-deadline','moderation-shortcut') ORDER BY kind", [input.revisionId, input.id])
      await client.query('COMMIT')
      return { inserted: false, receivedAt: prior.received_at, deadline: prior.deadline, jobIds: jobs.rows.map(row => row.id) }
    }
    const current = await client.query(`SELECT 1 FROM idea_revisions r JOIN ideas i ON i.id = r.idea_id
      WHERE r.id = $1 AND i.publication_state <> 'withdrawn' AND r.review_state NOT IN ('approved','rejected')
      AND NOT EXISTS (SELECT 1 FROM idea_revisions newer WHERE newer.idea_id = r.idea_id AND newer.version > r.version)`, [input.revisionId])
    if (!current.rowCount) throw new Error('Revision is no longer eligible for assessment')
    await client.query('UPDATE revision_assessments SET current = false WHERE revision_id = $1 AND current', [input.revisionId])
    await client.query('INSERT INTO review_gates (revision_id) VALUES ($1) ON CONFLICT DO NOTHING', [input.revisionId])
    const saved = await client.query<{ received_at: Date, deadline: Date | null }>(`
      WITH receipt AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS at)
      INSERT INTO revision_assessments (id, revision_id, fingerprint, received_at, deadline, wait_milliseconds, shortcut_requested)
      SELECT $1, $2, $3, at, CASE WHEN $4::int IS NULL THEN NULL ELSE at + ($4::int * interval '1 millisecond') END, $4, $5 FROM receipt
      RETURNING received_at, deadline`, [input.id, input.revisionId, input.fingerprint, input.waitMilliseconds, input.shortcutRequested])
    const { received_at: receivedAt, deadline } = saved.rows[0]
    if (deadline) {
      await enqueueJob(client, { idempotencyKey: `moderation-deadline:${input.revisionId}:${input.id}`, kind: 'moderation-deadline',
        revisionId: input.revisionId, assessmentId: input.id, assessmentReceivedAt: receivedAt, scheduledAt: deadline })
      if (input.shortcutRequested && deadline > receivedAt) {
        await enqueueJob(client, { idempotencyKey: `moderation-shortcut:${input.revisionId}:${input.id}`, kind: 'moderation-shortcut',
          revisionId: input.revisionId, assessmentId: input.id, assessmentReceivedAt: receivedAt, scheduledAt: receivedAt })
      }
    }
    const jobs = await client.query<{ id: string }>("SELECT id FROM jobs WHERE revision_id = $1 AND assessment_id = $2 AND kind IN ('moderation-deadline','moderation-shortcut') ORDER BY kind", [input.revisionId, input.id])
    await client.query('COMMIT')
    return { inserted: true, receivedAt, deadline, jobIds: jobs.rows.map(row => row.id) }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

/**
 * Attempt delivery after commit. An unconfirmed result means the dispatcher did
 * not confirm this attempt; it may already have been delivered or be leased by
 * another dispatcher. Inspect durable state before recovery or replay.
 */
export async function recordAndDispatchAssessment(pool: pg.Pool, input: AcceptedAssessment, dispatcher: JobDispatcher) {
  const accepted = await recordAcceptedAssessment(pool, input)
  let dispatchFailures = 0
  let dispatchUnconfirmed = 0
  for (const jobId of accepted.jobIds) {
    try {
      if (await dispatchJob(pool, dispatcher, jobId) === 'unavailable') dispatchUnconfirmed++
    } catch { dispatchFailures++ }
  }
  return { ...accepted, dispatchFailures, dispatchUnconfirmed }
}

/** Use stale only for permanent ineligibility; unavailable evidence must return retry. */
export type ApprovalPolicy = (client: pg.PoolClient, job: DurableJob) => Promise<'allow' | 'stale' | 'retry'>

/** Lock and recheck a revision before recording approval and its projection job atomically. */
export async function executeModerationJob(pool: pg.Pool, jobId: string, policy: ApprovalPolicy) {
  return executeJob(pool, jobId, async (client, job) => {
    if (!job.revisionId || !job.assessmentId || !['moderation-deadline', 'moderation-shortcut'].includes(job.kind)) throw new Error('Invalid moderation job')
    const result = await client.query<{ idea_id: string, blocked: boolean }>(`
      SELECT i.id AS idea_id, g.blocked FROM ideas i JOIN idea_revisions r ON r.idea_id = i.id
      JOIN revision_assessments a ON a.revision_id = r.id JOIN review_gates g ON g.revision_id = r.id
      WHERE r.id = $1 AND a.id = $2 FOR UPDATE OF i, r, a, g`, [job.revisionId, job.assessmentId])
    if (!result.rowCount) return 'stale'
    const eligible = await client.query(`SELECT 1 FROM ideas i JOIN idea_revisions r ON r.idea_id = i.id
      JOIN revision_assessments a ON a.revision_id = r.id JOIN review_gates g ON g.revision_id = r.id
      WHERE i.id = $1 AND r.id = $2 AND a.id = $3 AND a.current AND a.deadline IS NOT NULL
        AND i.publication_state <> 'withdrawn' AND r.review_state NOT IN ('approved','rejected')
        AND a.received_at = $4::timestamptz
        AND (($5 = 'moderation-deadline' AND a.deadline = $6::timestamptz) OR ($5 = 'moderation-shortcut' AND a.shortcut_requested AND a.received_at = $6::timestamptz))
        AND NOT EXISTS (SELECT 1 FROM idea_revisions newer WHERE newer.idea_id = i.id AND newer.version > r.version)`,
    [result.rows[0].idea_id, job.revisionId, job.assessmentId, job.assessmentReceivedAt, job.kind, job.scheduledAt])
    if (!eligible.rowCount) return 'stale'
    if (result.rows[0].blocked) throw new Error('Moderation is on hold')
    // Query after acquiring the idea lock so a hold committed while this job
    // waited is visible under READ COMMITTED. Other review blocks remain separate.
    const hold = await client.query(`SELECT 1 FROM moderator_holds h JOIN idea_revisions r ON r.id = h.revision_id
      WHERE r.idea_id = $1 AND h.released_at IS NULL`, [result.rows[0].idea_id])
    if (hold.rowCount) throw new Error('Moderation is on hold')
    const decision = await policy(client, job)
    if (decision === 'retry') throw new Error('Moderation eligibility is unavailable')
    if (decision === 'stale') return 'stale'
    if (decision !== 'allow') throw new Error('Invalid moderation decision')
    await client.query("UPDATE idea_revisions SET review_state = 'approved' WHERE id = $1", [job.revisionId])
    await client.query('INSERT INTO approved_revisions (idea_id, revision_id) VALUES ($1, $2) ON CONFLICT (idea_id) DO UPDATE SET revision_id = EXCLUDED.revision_id', [result.rows[0].idea_id, job.revisionId])
    await client.query("UPDATE ideas SET publication_state = 'approved' WHERE id = $1", [result.rows[0].idea_id])
    await recordApprovedSubmission(client, result.rows[0].idea_id, job.revisionId)
    await enqueueJob(client, { idempotencyKey: `projection:${job.revisionId}:${job.assessmentId}`, kind: 'projection',
      revisionId: job.revisionId, scheduledAt: new Date() })
    return 'completed'
  })
}
