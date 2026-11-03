import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import pg from 'pg'
import { createCloudTasksDispatcher, recordAndDispatchAssessment, reconcileOutbox, standardReviewWaitMilliseconds } from '@idea-map/server'
import { createWorkerHandler } from '../dist/worker.js'
import { createJobExecutor } from '../dist/job-router.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_') || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL must name a local migrated disposable database beginning idea_map_test_')
}

// The transport, token verifier, and approval callback are fakes. This does not
// enable the production worker's automatic publication or prove provider behavior.
test('policy deadlines survive authenticated delivery, lost responses, and delayed repair', async () => {
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
    const dispatcher = createCloudTasksDispatcher({ queue, workerOrigin: origin, invokerEmail: taskInvoker,
      transport: { async request(method, path, body) {
        if (method === 'GET') return { status: tasks.has(path.split('?')[0]) ? 200 : 404, data: tasks.get(path.split('?')[0]) }
        assert.equal(path, `${queue}/tasks`)
        if (tasks.has(body.task.name)) return { status: 409 }
        tasks.set(body.task.name, body.task)
        if (loseResponse) { loseResponse = false; throw new Error('synthetic lost response') }
        return { status: 200 }
      } },
    })
    server = createServer(createWorkerHandler({ origin, taskInvoker, repairInvoker,
      async verify(token, audience) {
        if (audience !== origin || !['task', 'repair'].includes(token)) throw new Error('invalid token')
        return { email: token === 'task' ? taskInvoker : repairInvoker, verified: true }
      },
      execute: createJobExecutor(pool, { moderationPolicy: async () => 'allow' }),
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
    const taskFor = id => tasks.get(`${queue}/tasks/job-${id}-0`)

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
  } finally {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    if (pool) await pool.end()
    await setup.end()
  }
})
