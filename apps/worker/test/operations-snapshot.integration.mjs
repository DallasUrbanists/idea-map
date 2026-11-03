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

test('snapshot distinguishes an open, closed, and missing public-access gate', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 1 })
  try {
    assert.equal((await readOperationsSnapshot(pool)).public_access_open, false)
    await pool.query('UPDATE public.public_access_gate SET is_open=true WHERE singleton=true')
    assert.equal((await readOperationsSnapshot(pool)).public_access_open, true)
    await pool.query('DELETE FROM public.public_access_gate WHERE singleton=true')
    assert.equal((await readOperationsSnapshot(pool)).public_access_open, null)
  } finally {
    await pool.query('INSERT INTO public.public_access_gate(singleton,is_open) VALUES (true,false) ON CONFLICT (singleton) DO UPDATE SET is_open=false')
    await pool.end()
  }
})

test('an outbox row committed after the observation time has age zero', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 })
  const marker = `snapshot-race-${randomUUID()}`
  let jobId
  try {
    const before = await readOperationsSnapshot(pool)
    assert.equal(before.backlog.unpublished, 0, 'Use a dedicated, otherwise empty synthetic operations database')
    const racingPool = { async connect() {
      const client = await pool.connect()
      return {
        async query(statement, ...args) {
          if (statement.includes('WITH snapshot AS')) {
            jobId = (await pool.query("INSERT INTO jobs(kind,idempotency_key,scheduled_at) VALUES ('test',$1,now()+interval '1 hour') RETURNING id", [marker])).rows[0].id
            await pool.query('INSERT INTO outbox(job_id,created_at) VALUES ($1,clock_timestamp())', [jobId])
          }
          return client.query(statement, ...args)
        },
        release() { client.release() },
      }
    } }
    const snapshot = await readOperationsSnapshot(racingPool)
    assert.equal(snapshot.backlog.unpublished, 1)
    assert.equal(snapshot.backlog.oldest_seconds, 0)
  } finally {
    if (jobId) {
      await pool.query('DELETE FROM outbox WHERE job_id=$1', [jobId])
      await pool.query('DELETE FROM jobs WHERE id=$1', [jobId])
    }
    await pool.end()
  }
})

test('the snapshot works with column-scoped read-only access', async () => {
  const target = new URL(url)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/idea_map_test_operations') {
    throw new Error('Role tests require the dedicated local synthetic operations database')
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 })
  const role = `operations_test_${randomUUID().replaceAll('-', '')}`
  let created = false
  let client
  try {
    await pool.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`)
    created = true
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await pool.query(`GRANT SELECT (id, state, scheduled_at) ON public.jobs TO "${role}"`)
    await pool.query(`GRANT SELECT (job_id, published_at, dispatch_attempts, created_at) ON public.outbox TO "${role}"`)
    await pool.query(`GRANT SELECT (event_type, created_at) ON public.email_delivery_events TO "${role}"`)
    await pool.query(`GRANT SELECT (singleton, is_open) ON public.public_access_gate TO "${role}"`)
    client = await pool.connect()
    await client.query(`SET ROLE "${role}"`)
    const scopedPool = { async connect() { return { query: client.query.bind(client), release() {} } } }
    const snapshot = await readOperationsSnapshot(scopedPool)
    assert.equal(snapshot.backlog.unpublished, 0)
    assert.equal(snapshot.public_access_open, false)
    await assert.rejects(client.query('SELECT idempotency_key FROM public.jobs'), { code: '42501' })
    await assert.rejects(client.query('SELECT email_id FROM public.email_delivery_events'), { code: '42501' })
    await assert.rejects(client.query('SELECT * FROM public.contacts'), { code: '42501' })
    await assert.rejects(client.query('UPDATE public.outbox SET published_at=now()'), { code: '42501' })
    await assert.rejects(client.query('UPDATE public.public_access_gate SET is_open=true'), { code: '42501' })
  } finally {
    if (client) { await client.query('RESET ROLE'); client.release() }
    if (created) {
      await pool.query(`DROP OWNED BY "${role}"`)
      await pool.query(`DROP ROLE "${role}"`)
    }
    await pool.end()
  }
})
