import type pg from 'pg'

/** Read aggregate database signals without returning job or message identifiers. */
export async function readOperationsSnapshot(pool: pg.Pool) {
  const client = await pool.connect()
  let destroy = false
  try {
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '5s'")
    // A row committed between BEGIN and the statement can be newer than the
    // transaction timestamp. Clamp that tiny observation race to zero.
    const result = await client.query(`
      WITH snapshot AS (SELECT transaction_timestamp() AS observed_at),
      backlog AS (
        SELECT count(*)::int AS unpublished,
          count(*) FILTER (WHERE o.dispatch_attempts >= 5)::int AS exhausted,
          max(greatest(0, extract(epoch FROM (s.observed_at - o.created_at))))::float8 AS oldest_seconds
        FROM outbox o JOIN jobs j ON j.id = o.job_id CROSS JOIN snapshot s
        WHERE o.published_at IS NULL AND j.state = 'pending'
      ), overdue AS (
        SELECT count(*)::int AS count,
          max(extract(epoch FROM (s.observed_at - j.scheduled_at)))::float8 AS oldest_seconds
        FROM jobs j CROSS JOIN snapshot s
        WHERE j.state = 'pending' AND j.scheduled_at <= s.observed_at
      ), email AS (
        SELECT count(*) FILTER (WHERE e.event_type = 'email.failed')::int AS failed,
          count(*) FILTER (WHERE e.event_type = 'email.bounced')::int AS bounced,
          count(*) FILTER (WHERE e.event_type = 'email.suppressed')::int AS suppressed,
          count(*) FILTER (WHERE e.event_type = 'email.delivery_delayed')::int AS delayed,
          count(*) FILTER (WHERE e.event_type = 'email.complained')::int AS complained
        FROM email_delivery_events e CROSS JOIN snapshot s
        WHERE e.created_at > s.observed_at - interval '24 hours' AND e.created_at <= s.observed_at
      )
      SELECT s.observed_at, row_to_json(backlog) AS backlog,
        row_to_json(overdue) AS overdue, row_to_json(email) AS email,
        pg_catalog.pg_database_size(pg_catalog.current_database())::text AS database_size_bytes,
        (SELECT is_open FROM public.public_access_gate WHERE singleton = true) AS gate_open,
        public.public_access_allowed() AS guard_allowed
      FROM snapshot s CROSS JOIN backlog CROSS JOIN overdue CROSS JOIN email
    `)
    const row = result.rows[0]
    if (result.rows.length !== 1 || !row || (row.gate_open !== null && typeof row.gate_open !== 'boolean') ||
        typeof row.guard_allowed !== 'boolean') throw new Error('Operations snapshot is invalid')
    const { gate_open, guard_allowed, ...snapshot } = row
    await client.query('COMMIT')
    return { ...snapshot, public_access_open: gate_open === null ? null : gate_open && guard_allowed }
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { destroy = true }
    throw error
  } finally {
    client.release(destroy)
  }
}
