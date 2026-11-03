import type pg from 'pg'
import { executeJob, type ApprovalPolicy, type DurableJob } from '@idea-map/server'
import { createModerationExecutor } from './executor.js'
import type { WorkerDependencies } from './worker.js'

/** A database-only handler must recheck domain eligibility before committing any effect. */
type ProjectionHandler = (client: pg.PoolClient, job: DurableJob) => Promise<'completed' | 'stale'>

/** Unsupported work stays pending. The handler rechecks kind under the job lock. */
export function createJobExecutor(pool: pg.Pool, options: { moderationPolicy?: ApprovalPolicy, projection?: ProjectionHandler } = {}): WorkerDependencies['execute'] {
  if (!options.moderationPolicy && !options.projection) return async () => 'unavailable'
  const moderate = createModerationExecutor(pool, options.moderationPolicy)
  return async jobId => {
    const result = await pool.query<{ kind: string }>('SELECT kind FROM jobs WHERE id = $1', [jobId])
    const kind = result.rows[0]?.kind
    if (!kind) return 'missing'
    if (kind === 'moderation-deadline' || kind === 'moderation-shortcut') {
      return options.moderationPolicy ? moderate(jobId) : 'unavailable'
    }
    if (kind !== 'projection' || !options.projection) return 'unavailable'
    const handler = options.projection
    return executeJob(pool, jobId, async (client, job) => {
      if (job.kind !== 'projection') throw new Error('Job kind changed during routing')
      return handler(client, job)
    }, ['projection'])
  }
}
