import type pg from 'pg'

/** Read one durable job snapshot; this does not inspect or authorize provider delivery. */
export async function inspectJob(pool: pg.Pool, jobId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) throw new Error('Invalid job ID')
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    const result = await client.query(`SELECT j.id AS job_id, j.kind, j.state, j.revision_id, j.assessment_id,
      j.assessment_received_at, a.deadline AS assessment_deadline, j.scheduled_at,
      o.dispatch_attempts, o.delivery_generation, o.published_at AS acknowledged_at, o.lease_until,
      CASE WHEN o.id IS NULL THEN 'no-outbox' WHEN o.lease_until IS NULL THEN 'none'
        WHEN o.lease_until > clock_timestamp() THEN 'active' ELSE 'expired' END AS lease_status
      FROM jobs j LEFT JOIN outbox o ON o.job_id = j.id
      LEFT JOIN revision_assessments a ON a.id = j.assessment_id AND a.revision_id = j.revision_id
      WHERE j.id = $1`, [jobId])
    await client.query('COMMIT')
    return result.rows[0] ?? null
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
