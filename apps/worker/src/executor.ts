import type pg from 'pg'
import { executeModerationJob, type ApprovalPolicy } from '@idea-map/server'
import type { WorkerDependencies } from './worker.js'

/** No policy means the worker must not claim or execute any durable job. */
export function createModerationExecutor(pool: pg.Pool, policy?: ApprovalPolicy): WorkerDependencies['execute'] {
  if (!policy) return async () => 'unavailable'
  return async jobId => executeModerationJob(pool, jobId, policy)
}
