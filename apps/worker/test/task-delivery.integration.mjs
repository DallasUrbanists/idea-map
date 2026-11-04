import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import pg from 'pg'
import { createCloudTasksDispatcher, recordAndDispatchAssessment, reconcileOutbox, standardReviewWaitMilliseconds } from '@idea-map/server'
import { createWorkerHandler } from '../dist/worker.js'
import { createJobExecutor } from '../dist/job-router.js'
import { recoverMissingTask } from '../dist/recover.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_') || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL must name a local migrated disposable database beginning idea_map_test_')
}

// The transport, token verifier, and approval callback are fakes. This does not
// enable the production worker's automatic publication or prove provider behavior.
test('policy deadlines survive delivery failures, guarded recovery, and replay', async () => {
  const setup = new pg.Pool({ connectionString: url, max: 2 })
  let pool, server
  try {
    await setup.query('CREATE SCHEMA delivery_clock')
    await setup.query('CREATE TABLE delivery_clock.current_time (at timestamptz NOT NULL)')
    await setup.query("INSERT INTO delivery_clock.current_time VALUES ('2030-01-01T00:00:00Z')")
    await setup.query("CREATE FUNCTION delivery_clock.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT at FROM delivery_clock.current_time'")
    pool = new pg.Pool({ connectionString: url, max: 4, options: '-c search_path=delivery_clock,public,pg_catalog' })
    const advance = at => setup.query('UPDATE delivery_clock.current_time SET at=$1', [at])
    const queue = 'projects/synthetic-project/locations/us-central1/queues/jobs'
    const origin = 'https://worker.example.invalid'
    const taskInvoker = 'tasks@synthetic-project.iam.gserviceaccount.com'
    const repairInvoker = 'repair@synthetic-project.iam.gserviceaccount.com'
    const tasks = new Map()
    let loseResponse = false
    let rejectCreates = false
    let inspectionDenied = false
    let approvalUnavailable = false
    const transport = { async request(method, path, body) {
      if (method === 'GET' && path === queue) return { status: 200, data: { name: queue } }
      if (method === 'GET' && inspectionDenied) return { status: 403 }
      if (method === 'GET') return { status: tasks.has(path.split('?')[0]) ? 200 : 404, data: tasks.get(path.split('?')[0]) }
      assert.equal(path, `${queue}/tasks`)
      if (rejectCreates) return { status: 503 }
      if (tasks.has(body.task.name)) return { status: 409 }
      tasks.set(body.task.name, body.task)
      if (loseResponse) { loseResponse = false; throw new Error('synthetic lost response') }
      return { status: 200 }
    } }
    const dispatcher = createCloudTasksDispatcher({ queue, workerOrigin: origin, invokerEmail: taskInvoker, transport })
    server = createServer(createWorkerHandler({ origin, taskInvoker, repairInvoker,
      async verify(token, audience) {
        if (audience !== origin || !['task', 'repair'].includes(token)) throw new Error('invalid token')
        return { email: token === 'task' ? taskInvoker : repairInvoker, verified: true }
      },
      execute: createJobExecutor(pool, { moderationPolicy: async () => approvalUnavailable ? 'retry' : 'allow' }),
      async repair() { return reconcileOutbox(pool, dispatcher, 20) },
    }))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const post = (path, token, body = {}) => fetch(`${base}${path}`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('delivery-clock@example.invalid') RETURNING id")).rows[0].id
    const createRevision = async () => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      return { idea, revision }
    }
    const assess = (id, revisionId, score) => recordAndDispatchAssessment(pool, { id, revisionId,
      fingerprint: 'a'.repeat(64), waitMilliseconds: standardReviewWaitMilliseconds(score), shortcutRequested: false }, dispatcher)
    const taskName = (id, generation = 0) => `${queue}/tasks/job-${id}-${generation}`
    const taskFor = (id, generation = 0) => tasks.get(taskName(id, generation))
    const durable = async id => (await pool.query(`SELECT j.state, j.scheduled_at, o.dispatch_attempts, o.delivery_generation, o.published_at
      FROM jobs j JOIN outbox o ON o.job_id=j.id WHERE j.id=$1`, [id])).rows[0]
    const recover = (id, generation = 0) => recoverMissingTask(pool, transport, { queue, jobId: id, generation }, new AbortController().signal)

    const immediate = await createRevision()
    const instant = await assess('delivery-immediate', immediate.revision, 95)
    assert.equal(instant.deadline.getTime(), instant.receivedAt.getTime())
    assert.equal(taskFor(instant.jobIds[0]).scheduleTime, instant.deadline.toISOString())
    assert.equal((await post('/tasks/execute', 'repair', { jobId: instant.jobIds[0] })).status, 403)
    assert.equal((await post('/tasks/execute', 'task', { jobId: instant.jobIds[0] })).status, 204)
    assert.equal((await post('/tasks/execute', 'task', { jobId: instant.jobIds[0] })).status, 204)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [immediate.revision])).rows[0].n, 1)

    const delayed = await createRevision()
    loseResponse = true
    const saved = await assess('delivery-delayed', delayed.revision, 60)
    const jobId = saved.jobIds[0]
    const originalTask = taskFor(jobId)
    assert.equal(saved.dispatchFailures, 1)
    assert.equal(saved.deadline.getTime() - saved.receivedAt.getTime(), 86_400_000)
    assert.equal(originalTask.scheduleTime, saved.deadline.toISOString())
    assert.deepEqual(JSON.parse(Buffer.from(originalTask.httpRequest.body, 'base64').toString()), { jobId })
    assert.equal(originalTask.httpRequest.oidcToken.audience, origin)
    assert.equal(originalTask.httpRequest.oidcToken.serviceAccountEmail, taskInvoker)
    assert.equal((await post('/tasks/execute', 'task', { jobId })).status, 503)
    await advance(new Date(saved.deadline.getTime() + 3_600_000))
    assert.equal((await post('/tasks/repair', 'task')).status, 403)
    assert.equal((await post('/tasks/repair', 'repair')).status, 204)
    assert.equal(taskFor(jobId), originalTask)
    assert.equal((await pool.query('SELECT published_at IS NOT NULL AS published FROM outbox WHERE job_id=$1', [jobId])).rows[0].published, true)
    const replay = await assess('delivery-delayed', delayed.revision, 60)
    assert.equal(replay.inserted, false)
    assert.equal(replay.deadline.getTime(), saved.deadline.getTime())
    assert.equal((await post('/tasks/execute', 'task', { jobId })).status, 204)
    assert.equal((await post('/tasks/execute', 'task', { jobId })).status, 204)
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id=$1', [delayed.idea])).rows[0].revision_id, delayed.revision)

    const superseded = await createRevision()
    const old = await assess('delivery-old', superseded.revision, 60)
    const replacement = await assess('delivery-replacement', superseded.revision, 60)
    await advance(replacement.deadline)
    assert.equal((await post('/tasks/execute', 'task', { jobId: old.jobIds[0] })).status, 204)
    assert.equal((await pool.query('SELECT state FROM jobs WHERE id=$1', [old.jobIds[0]])).rows[0].state, 'stale')
    await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}')", [superseded.idea])
    assert.equal((await post('/tasks/execute', 'task', { jobId: replacement.jobIds[0] })).status, 204)
    assert.equal((await pool.query('SELECT state FROM jobs WHERE id=$1', [replacement.jobIds[0]])).rows[0].state, 'stale')
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [superseded.idea])).rows[0].publication_state, 'private')

    // Exhaust the database's five create attempts, then require a confirmed
    // absence before an operator rearms a fresh delivery generation.
    assert.equal((await post('/tasks/repair', 'repair')).status, 204)
    const dispatchTarget = await createRevision()
    rejectCreates = true
    const dispatchAssessment = await assess('delivery-dispatch-exhausted', dispatchTarget.revision, 60)
    const dispatchId = dispatchAssessment.jobIds[0]
    assert.equal(dispatchAssessment.dispatchFailures, 1)
    for (let attempt = 2; attempt <= 5; attempt++) {
      assert.equal((await post('/tasks/repair', 'repair')).status, 503)
      assert.equal((await durable(dispatchId)).dispatch_attempts, attempt)
    }
    rejectCreates = false
    assert.equal((await post('/tasks/repair', 'repair')).status, 204)
    let row = await durable(dispatchId)
    assert.equal(row.dispatch_attempts, 5)
    assert.equal(row.published_at, null)
    assert.equal(taskFor(dispatchId), undefined)
    inspectionDenied = true
    assert.equal(await recover(dispatchId), 'unknown')
    assert.equal((await durable(dispatchId)).delivery_generation, 0)
    inspectionDenied = false
    assert.equal(await recover(dispatchId), 'rearmed')
    row = await durable(dispatchId)
    assert.equal(row.delivery_generation, 1)
    assert.equal(row.dispatch_attempts, 0)
    assert.equal(row.scheduled_at.getTime(), dispatchAssessment.deadline.getTime())
    assert.equal((await post('/tasks/repair', 'repair')).status, 204)
    assert.equal(taskFor(dispatchId, 1).scheduleTime, dispatchAssessment.deadline.toISOString())
    assert.equal((await post('/tasks/execute', 'task', { jobId: dispatchId })).status, 503)
    await advance(dispatchAssessment.deadline)
    assert.equal((await post('/tasks/execute', 'task', { jobId: dispatchId })).status, 204)
    assert.equal((await post('/tasks/execute', 'task', { jobId: dispatchId })).status, 204)
    assert.equal((await durable(dispatchId)).state, 'completed')
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [dispatchTarget.revision])).rows[0].n, 1)

    // Model five retryable HTTP deliveries and provider exhaustion. The fake
    // removes the task to represent provider-confirmed absence, not live behavior.
    const executionTarget = await createRevision()
    const executionAssessment = await assess('delivery-execution-exhausted', executionTarget.revision, 60)
    const executionId = executionAssessment.jobIds[0]
    await advance(new Date(executionAssessment.deadline.getTime() + 3_600_000))
    approvalUnavailable = true
    for (let attempt = 1; attempt <= 5; attempt++) {
      assert.equal((await post('/tasks/execute', 'task', { jobId: executionId })).status, 503)
    }
    row = await durable(executionId)
    assert.equal(row.state, 'pending')
    assert.ok(row.published_at)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [executionTarget.idea])).rows[0].publication_state, 'private')
    assert.equal(await recover(executionId), 'present')
    assert.equal((await durable(executionId)).delivery_generation, 0)
    tasks.delete(taskName(executionId))
    assert.equal(await recover(executionId), 'rearmed')
    assert.equal(await recover(executionId), 'unchanged')
    row = await durable(executionId)
    assert.equal(row.delivery_generation, 1)
    assert.equal(row.scheduled_at.getTime(), executionAssessment.deadline.getTime())
    assert.equal((await post('/tasks/repair', 'repair')).status, 204)
    const recoveredTask = taskFor(executionId, 1)
    assert.equal(recoveredTask.scheduleTime, executionAssessment.deadline.toISOString())
    assert.deepEqual(JSON.parse(Buffer.from(recoveredTask.httpRequest.body, 'base64').toString()), { jobId: executionId })
    approvalUnavailable = false
    assert.equal((await post('/tasks/execute', 'task', { jobId: executionId })).status, 204)
    assert.equal((await post('/tasks/execute', 'task', { jobId: executionId })).status, 204)
    tasks.delete(taskName(executionId, 1))
    assert.equal(await recover(executionId, 1), 'unchanged')
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id=$1', [executionTarget.idea])).rows[0].revision_id, executionTarget.revision)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [executionTarget.revision])).rows[0].n, 1)
  } finally {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    if (pool) await pool.end()
    await setup.end()
  }
})
