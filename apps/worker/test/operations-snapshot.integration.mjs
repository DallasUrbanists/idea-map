import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { readOperationsSnapshot } from '../dist/operations-snapshot.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a migrated disposable database beginning idea_map_test_')

test('snapshot reports private aggregate backlog, overdue jobs and recent failures', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 })
  const marker = `snapshot-${randomUUID()}`
  try {
    const before = await readOperationsSnapshot(pool)
    const rows = (await pool.query(`INSERT INTO jobs (kind, idempotency_key, state, scheduled_at)
      VALUES ('test', $1, 'pending', now() - interval '2 hours'),
             ('test', $2, 'pending', now() + interval '2 hours'),
             ('test', $3, 'completed', now() - interval '3 hours') RETURNING id`,
    [`${marker}-due`, `${marker}-future`, `${marker}-completed`])).rows
    await pool.query(`INSERT INTO outbox (job_id, created_at, dispatch_attempts)
      VALUES ($1, now() - interval '1 hour', 5), ($2, now(), 0), ($3, now(), 0)`, rows.map(row => row.id))
    await pool.query(`INSERT INTO email_delivery_events (event_id, email_id, event_type, occurred_at, created_at)
      VALUES ($1, $1, 'email.failed', now(), now()),
             ($2, $2, 'email.bounced', now(), now()),
             ($3, $3, 'email.failed', now() - interval '25 hours', now() - interval '25 hours')`,
    [`${marker}-failed`, `${marker}-bounced`, `${marker}-old`])
    const after = await readOperationsSnapshot(pool)
    assert.equal(after.backlog.unpublished - before.backlog.unpublished, 2)
    assert.equal(after.backlog.exhausted - before.backlog.exhausted, 1)
    assert.ok(after.backlog.oldest_seconds >= 3600)
    assert.equal(after.overdue.count - before.overdue.count, 1)
    assert.ok(after.overdue.oldest_seconds >= 7200)
    assert.equal(after.email.failed - before.email.failed, 1)
    assert.equal(after.email.bounced - before.email.bounced, 1)
    assert.equal(after.email.delayed, before.email.delayed)
    assert.ok(!JSON.stringify(after).includes(marker))
    assert.ok(rows.every(row => !JSON.stringify(after).includes(row.id)))
    const cli = fileURLToPath(new URL('../dist/operations-snapshot-cli.js', import.meta.url))
    const success = spawnSync(process.execPath, [cli], { encoding: 'utf8', env: { ...process.env, OPERATIONS_DATABASE_URL: url } })
    assert.equal(success.status, 0)
    assert.equal(JSON.parse(success.stdout).email.failed, after.email.failed)
    assert.ok(!success.stdout.includes(marker))
    const failure = spawnSync(process.execPath, [cli], { encoding: 'utf8', env: { ...process.env, OPERATIONS_DATABASE_URL: 'postgres://secret-synthetic-password@invalid.invalid/db' } })
    assert.equal(failure.status, 1)
    assert.doesNotMatch(failure.stderr, /secret-synthetic-password/)
  } finally {
    await pool.query('DELETE FROM email_delivery_events WHERE event_id = ANY($1::text[])', [[`${marker}-failed`, `${marker}-bounced`, `${marker}-old`]])
    await pool.query('DELETE FROM outbox WHERE job_id IN (SELECT id FROM jobs WHERE idempotency_key = ANY($1::text[]))', [[`${marker}-due`, `${marker}-future`, `${marker}-completed`]])
    await pool.query('DELETE FROM jobs WHERE idempotency_key = ANY($1::text[])', [[`${marker}-due`, `${marker}-future`, `${marker}-completed`]])
    await pool.end()
  }
})
