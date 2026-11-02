import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createJobIntent, dispatchJob, enqueueJob, executeJob, reconcileOutbox, retryExhaustedDispatch } from '../dist/outbox.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) {
  throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')
}

test('durable dispatch, recovery and transactional execution', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 6 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    await pool.query('CREATE TABLE outbox_test_domain (id text PRIMARY KEY, revision_id uuid NOT NULL, assessment_id text NOT NULL, held boolean NOT NULL DEFAULT false, published integer NOT NULL DEFAULT 0)')
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('outbox@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id, version, content) VALUES ($1, 1, '{}') RETURNING id", [idea])).rows[0].id
    const otherRevision = (await pool.query("INSERT INTO idea_revisions(idea_id, version, content) VALUES ($1, 2, '{}') RETURNING id", [idea])).rows[0].id
    const received = new Date(Date.now() - 100_000)
    const deadline = new Date(Date.now() - 10_000)
    const intent = { idempotencyKey: 'assessment-1', kind: 'approval', revisionId: revision, assessmentId: 'a1', assessmentReceivedAt: received, scheduledAt: deadline }
    const change = (client) => client.query("INSERT INTO outbox_test_domain (id, revision_id, assessment_id) VALUES ('idea', $1, 'a1')", [revision])

    await assert.rejects(createJobIntent(pool, { ...intent, idempotencyKey: 'rollback', assessmentId: 'rollback' }, async client => {
      await client.query("INSERT INTO outbox_test_domain (id, revision_id, assessment_id) VALUES ('rollback', $1, 'rollback')", [revision])
      throw new Error('rollback')
    }), /rollback/)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE idempotency_key = 'rollback'")).rows[0].n, 0)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM outbox_test_domain WHERE id = 'rollback'")).rows[0].n, 0)

    const created = await Promise.all([createJobIntent(pool, intent, change), createJobIntent(pool, intent, change)])
    assert.deepEqual(created.map(value => value.inserted).sort(), [false, true])
    const job = created[0].job
    assert.equal(created[1].job.id, job.id)
    await assert.rejects(createJobIntent(pool, { ...intent, scheduledAt: new Date(deadline.getTime() + 1000) }, change), /conflicts/)
    await assert.rejects(createJobIntent(pool, { ...intent, idempotencyKey: 'different-key' }, change), { code: '23505' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM outbox WHERE job_id = $1', [job.id])).rows[0].n, 1)

    const deliveries = []
    const ambiguous = { async dispatch(value) { deliveries.push(value); throw new Error('response lost') } }
    await assert.rejects(dispatchJob(pool, ambiguous, job.id), /response lost/)
    let release
    let started
    const startedPromise = new Promise(resolve => { started = resolve })
    const hold = new Promise(resolve => { release = resolve })
    const slow = { async dispatch(value) { deliveries.push(value); started(); await hold } }
    const firstPass = reconcileOutbox(pool, slow, 1)
    await startedPromise
    assert.deepEqual(await reconcileOutbox(pool, slow, 1), { attempted: 0, failed: 0 })
    release()
    assert.deepEqual(await firstPass, { attempted: 1, failed: 0 })
    assert.equal(deliveries[0].id, deliveries[1].id)
    assert.equal(deliveries[1].scheduledAt.getTime(), deadline.getTime())
    assert.equal(deliveries[1].assessmentReceivedAt.getTime(), received.getTime())
    assert.equal(await dispatchJob(pool, slow, job.id), 'unavailable')

    const leaseJob = (await createJobIntent(pool, { idempotencyKey: 'lease', kind: 'test', scheduledAt: deadline }, async () => {})).job
    let finishOld
    let oldStarted
    const oldStartedPromise = new Promise(resolve => { oldStarted = resolve })
    const oldHold = new Promise(resolve => { finishOld = resolve })
    const oldDispatch = dispatchJob(pool, { async dispatch() { oldStarted(); await oldHold } }, leaseJob.id)
    await oldStartedPromise
    await pool.query("UPDATE outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE job_id = $1", [leaseJob.id])
    assert.equal(await dispatchJob(pool, { async dispatch() {} }, leaseJob.id), 'dispatched')
    finishOld()
    assert.equal(await oldDispatch, 'unavailable')

    const exhausted = (await createJobIntent(pool, { idempotencyKey: 'failure', kind: 'test', scheduledAt: deadline }, async () => {})).job
    for (let i = 0; i < 5; i++) assert.deepEqual(await reconcileOutbox(pool, ambiguous, 1), { attempted: 1, failed: 1 })
    assert.deepEqual(await reconcileOutbox(pool, ambiguous, 1), { attempted: 0, failed: 0 })
    assert.equal(await retryExhaustedDispatch(pool, exhausted.id), true)
    assert.equal(await retryExhaustedDispatch(pool, exhausted.id), false)
    assert.equal(await dispatchJob(pool, { async dispatch() {} }, exhausted.id), 'dispatched')

    const hung = (await createJobIntent(pool, { idempotencyKey: 'hung', kind: 'test', scheduledAt: deadline }, async () => {})).job
    const next = (await createJobIntent(pool, { idempotencyKey: 'after-hung', kind: 'test', scheduledAt: deadline }, async () => {})).job
    let timedOutSignal
    const observed = []
    const sometimesHung = { async dispatch(value, signal) {
      observed.push(value.id)
      if (value.id === hung.id) {
        timedOutSignal = signal
        await new Promise(() => {})
      }
    } }
    assert.deepEqual(await reconcileOutbox(pool, sometimesHung, 2, { timeoutMs: 20 }), { attempted: 2, failed: 1 })
    assert.equal(timedOutSignal.aborted, true)
    assert.deepEqual(observed, [hung.id, next.id])
    assert.equal(await dispatchJob(pool, { async dispatch() {} }, hung.id), 'dispatched')
    await assert.rejects(reconcileOutbox(pool, sometimesHung, 1, { timeoutMs: 240_001 }), /Dispatch timeout/)

    const terminal = (await createJobIntent(pool, { idempotencyKey: 'terminal', kind: 'test', scheduledAt: deadline }, async () => {})).job
    await pool.query('UPDATE outbox SET dispatch_attempts = 5 WHERE job_id = $1', [terminal.id])
    assert.equal(await executeJob(pool, terminal.id, async () => 'stale'), 'stale')
    assert.equal(await retryExhaustedDispatch(pool, terminal.id), false)

    const handler = async (client, current) => {
      const state = (await client.query("SELECT * FROM outbox_test_domain WHERE id = 'idea' FOR UPDATE")).rows[0]
      if (state.held || state.revision_id !== current.revisionId || state.assessment_id !== current.assessmentId) return 'stale'
      await client.query("UPDATE outbox_test_domain SET published = published + 1 WHERE id = 'idea'")
      await enqueueJob(client, { idempotencyKey: `projection-${current.id}`, kind: 'projection', scheduledAt: deadline })
      return 'completed'
    }
    assert.deepEqual((await Promise.all([executeJob(pool, job.id, handler), executeJob(pool, job.id, handler)])).sort(), ['completed', 'duplicate'])
    assert.equal((await pool.query("SELECT published FROM outbox_test_domain WHERE id = 'idea'")).rows[0].published, 1)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind = 'projection'")).rows[0].n, 1)

    const superseded = (await createJobIntent(pool, { ...intent, idempotencyKey: 'assessment-2', assessmentId: 'a2' }, async client => {
      await client.query("UPDATE outbox_test_domain SET assessment_id = 'a2' WHERE id = 'idea'")
    })).job
    await pool.query("UPDATE outbox_test_domain SET assessment_id = 'a3' WHERE id = 'idea'")
    assert.equal(await executeJob(pool, superseded.id, handler), 'stale')
    assert.equal((await pool.query("SELECT published FROM outbox_test_domain WHERE id = 'idea'")).rows[0].published, 1)

    const oldRevision = (await createJobIntent(pool, { ...intent, idempotencyKey: 'old-revision', assessmentId: 'a3' }, async () => {})).job
    await pool.query("UPDATE outbox_test_domain SET revision_id = $1 WHERE id = 'idea'", [otherRevision])
    assert.equal(await executeJob(pool, oldRevision.id, handler), 'stale')
    const held = (await createJobIntent(pool, { ...intent, idempotencyKey: 'assessment-3', revisionId: otherRevision, assessmentId: 'a3' }, async () => {})).job
    const moderator = await pool.connect()
    try {
      await moderator.query('BEGIN')
      await moderator.query("UPDATE outbox_test_domain SET held = true WHERE id = 'idea'")
      const approval = executeJob(pool, held.id, handler)
      await moderator.query('COMMIT')
      assert.equal(await approval, 'stale')
    } finally { moderator.release() }
    assert.equal((await pool.query("SELECT published FROM outbox_test_domain WHERE id = 'idea'")).rows[0].published, 1)

    const futureReceived = new Date()
    const futureDeadline = new Date(futureReceived.getTime() + 86_400_000)
    const future = (await createJobIntent(pool, { idempotencyKey: 'future', kind: 'approval', revisionId: otherRevision,
      assessmentId: 'a4', assessmentReceivedAt: futureReceived, scheduledAt: futureDeadline }, async () => {})).job
    let futureDelivery
    assert.equal(await dispatchJob(pool, { async dispatch(value) { futureDelivery = value } }, future.id), 'dispatched')
    assert.equal(futureDelivery.scheduledAt.getTime(), futureDeadline.getTime())
    assert.equal(futureDelivery.assessmentReceivedAt.getTime(), futureReceived.getTime())
    assert.equal(await executeJob(pool, future.id, handler), 'not-due')

    const rollbackJob = (await createJobIntent(pool, { idempotencyKey: 'handler-rollback', kind: 'test', scheduledAt: deadline }, async () => {})).job
    await assert.rejects(executeJob(pool, rollbackJob.id, async client => {
      await client.query("UPDATE outbox_test_domain SET published = published + 1 WHERE id = 'idea'")
      await enqueueJob(client, { idempotencyKey: 'rolled-back-projection', kind: 'projection', scheduledAt: deadline })
      throw new Error('handler failed')
    }), /handler failed/)
    assert.equal((await pool.query("SELECT published FROM outbox_test_domain WHERE id = 'idea'")).rows[0].published, 1)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE idempotency_key = 'rolled-back-projection'")).rows[0].n, 0)
    assert.equal((await pool.query('SELECT state FROM jobs WHERE id = $1', [rollbackJob.id])).rows[0].state, 'pending')
  } finally {
    await pool.end()
  }
})
