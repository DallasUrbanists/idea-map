import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import pg from 'pg'
import { executeModerationJob, recordAndDispatchAssessment, reconcileOutbox } from '@idea-map/server'
import { createWorkerHandler } from '../dist/worker.js'

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
    async execute(id) { return executeModerationJob(pool, id, async () => 'allow') },
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
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind = 'projection' AND revision_id = $1", [revision])).rows[0].n, 1)
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
