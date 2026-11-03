import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import pg from 'pg'
import { recordAndDispatchAssessment, reconcileOutbox } from '@idea-map/server'
import { createWorkerHandler } from '../dist/worker.js'
import { createJobExecutor } from '../dist/job-router.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a migrated disposable database beginning idea_map_test_')

test('authenticated repair and duplicate task delivery use the durable database transaction', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 })
  const tasks = []
  const dispatcher = { async dispatch(job) { tasks.push(job) } }
  const origin = 'https://worker.example.invalid'
  const handler = createWorkerHandler({ origin, taskInvoker: 'task@example.invalid', repairInvoker: 'repair@example.invalid',
    async verify(token, audience) { if (audience !== origin) throw new Error('audience'); return { email: `${token}@example.invalid`, verified: true } },
    async repair() { return reconcileOutbox(pool, dispatcher, 20) },
    execute: createJobExecutor(pool, { moderationPolicy: async () => 'allow' }),
  })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('integration@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
    const input = { id: 'integration-assessment', revisionId: revision,
      fingerprint: 'c'.repeat(64), waitMilliseconds: 0, shortcutRequested: false }
    const assessment = await recordAndDispatchAssessment(pool, input, { async dispatch() { throw new Error('response lost') } })
    const jobId = (await pool.query("SELECT id FROM jobs WHERE assessment_id = 'integration-assessment'")).rows[0].id
    assert.equal(assessment.dispatchFailures, 1)
    assert.equal(assessment.dispatchUnconfirmed, 0)
    const base = `http://127.0.0.1:${server.address().port}`
    const post = (route, identity, body) => fetch(`${base}${route}`, { method: 'POST', headers: { authorization: `Bearer ${identity}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await post('/tasks/repair', 'repair', {})).status, 204)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].id, jobId)
    assert.equal(tasks[0].scheduledAt.getTime(), assessment.deadline.getTime())
    const duplicate = await recordAndDispatchAssessment(pool, input, { async dispatch() { throw new Error('must not dispatch twice') } })
    assert.equal(duplicate.inserted, false)
    assert.equal(duplicate.receivedAt.getTime(), assessment.receivedAt.getTime())
    assert.equal(duplicate.deadline.getTime(), assessment.deadline.getTime())
    assert.equal(duplicate.dispatchFailures, 0)
    assert.equal(duplicate.dispatchUnconfirmed, 1)
    assert.equal((await post('/tasks/execute', 'repair', { jobId })).status, 403)
    assert.equal((await post('/tasks/execute', 'task', { jobId })).status, 204)
    assert.equal((await post('/tasks/execute', 'task', { jobId })).status, 204)
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id = $1', [idea])).rows[0].revision_id, revision)
    const projection = (await pool.query("SELECT id,state FROM jobs WHERE kind = 'projection' AND revision_id = $1", [revision])).rows
    assert.equal(projection.length, 1)
    assert.equal((await post('/tasks/execute', 'task', { jobId: projection[0].id })).status, 503)
    assert.equal((await pool.query('SELECT state FROM jobs WHERE id=$1', [projection[0].id])).rows[0].state, 'pending')
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await pool.end()
  }
})

test('a concurrent assessment retry reports an unconfirmed dispatch without changing its deadline', { timeout: 15_000 }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 })
  let release
  const blocked = new Promise(resolve => { release = resolve })
  let started
  const dispatched = new Promise(resolve => { started = resolve })
  let first
  try {
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('dispatch-race@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
    const input = { id: 'dispatch-race', revisionId: revision, fingerprint: 'd'.repeat(64), waitMilliseconds: 86_400_000, shortcutRequested: false }
    first = recordAndDispatchAssessment(pool, input, { async dispatch() { started(); await blocked } })
    await Promise.race([dispatched, first.then(() => { throw new Error('dispatch did not start') })])
    const duplicate = await recordAndDispatchAssessment(pool, input, { async dispatch() { throw new Error('must not dispatch twice') } })
    assert.equal(duplicate.inserted, false)
    assert.equal(duplicate.dispatchFailures, 0)
    assert.equal(duplicate.dispatchUnconfirmed, 1)
    release()
    const original = await first
    assert.equal(original.dispatchFailures, 0)
    assert.equal(original.dispatchUnconfirmed, 0)
    assert.equal(duplicate.receivedAt.getTime(), original.receivedAt.getTime())
    assert.equal(duplicate.deadline.getTime(), original.deadline.getTime())
    assert.equal(original.deadline.getTime() - original.receivedAt.getTime(), 86_400_000)
  } finally {
    release()
    if (first) await first.catch(() => {})
    await pool.end()
  }
})

test('job router fails closed for unhandled kinds and commits synthetic effects once', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 })
  try {
    await pool.query('CREATE TABLE synthetic_routing_effects (job_id uuid PRIMARY KEY)')
    const create = async (kind, key) => (await pool.query(
      'INSERT INTO jobs(kind,idempotency_key,scheduled_at) VALUES ($1,$2,clock_timestamp()) RETURNING id', [kind, key])).rows[0].id
    const projection = await create('projection', 'routing-projection')
    const unknown = await create('synthetic-unknown', 'routing-unknown')
    const moderation = await create('moderation-deadline', 'routing-no-policy')
    let calls = 0
    let fail = true
    const execute = createJobExecutor(pool, { projection: async (client, job) => {
      calls++
      await client.query('INSERT INTO synthetic_routing_effects(job_id) VALUES ($1)', [job.id])
      if (fail) throw new Error('synthetic failure')
      return 'completed'
    } })
    for (const id of [unknown, moderation]) {
      assert.equal(await execute(id), 'unavailable')
      assert.equal((await pool.query('SELECT state FROM jobs WHERE id=$1', [id])).rows[0].state, 'pending')
    }
    assert.equal(await execute('11111111-1111-4111-8111-111111111111'), 'missing')
    await assert.rejects(execute(projection), /synthetic failure/)
    assert.equal((await pool.query('SELECT state FROM jobs WHERE id=$1', [projection])).rows[0].state, 'pending')
    assert.equal((await pool.query('SELECT count(*)::int n FROM synthetic_routing_effects')).rows[0].n, 0)
    fail = false
    assert.equal(await execute(projection), 'completed')
    assert.equal(await execute(projection), 'duplicate')
    assert.equal(calls, 2)
    assert.equal((await pool.query('SELECT count(*)::int n FROM synthetic_routing_effects')).rows[0].n, 1)

    // Simulate a kind change after routing's lookup but before the job lock.
    for (const [from, to, options] of [
      ['projection', 'synthetic-unknown', { projection: async () => 'completed' }],
      ['moderation-deadline', 'projection', { moderationPolicy: async () => 'allow' }],
    ]) {
      const raced = await create(from, `routing-race-${from}`)
      const racingPool = {
        async query(sql, params) {
          const result = await pool.query(sql, params)
          await pool.query("UPDATE jobs SET kind=$2, state='completed' WHERE id=$1", [raced, to])
          return result
        },
        connect: pool.connect.bind(pool),
      }
      await assert.rejects(createJobExecutor(racingPool, options)(raced), /Job kind changed during routing/)
      assert.equal((await pool.query('SELECT state FROM jobs WHERE id=$1', [raced])).rows[0].state, 'completed')
    }
  } finally { await pool.end() }
})
