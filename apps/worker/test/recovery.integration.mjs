import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { createJobIntent } from '@idea-map/server'
import { recoverMissingTask } from '../dist/recover.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a migrated disposable database beginning idea_map_test_')

test('recovery requires provider absence and unchanged durable state', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 })
  const queue = 'projects/synthetic-project/locations/us-central1/queues/jobs'
  const scheduledAt = new Date('2030-01-01T00:00:00Z')
  const fake = status => ({ async request(method, path) {
    assert.equal(method, 'GET')
    if (path === queue) return { status: 200, data: { name: queue } }
    assert.match(path, /^projects\/synthetic-project\/locations\/us-central1\/queues\/jobs\/tasks\/job-/)
    return { status, data: null }
  } })
  try {
    const { job } = await createJobIntent(pool, { idempotencyKey: 'recovery-integration', kind: 'test', scheduledAt }, async () => {})
    await pool.query('UPDATE outbox SET published_at = now() WHERE job_id = $1', [job.id])
    const input = { queue, jobId: job.id, generation: 0 }
    assert.equal(await recoverMissingTask(pool, fake(200), input, new AbortController().signal), 'present')
    assert.equal(await recoverMissingTask(pool, fake(403), input, new AbortController().signal), 'unknown')
    assert.equal(await recoverMissingTask(pool, { async request() { return { status: 404, data: null } } }, input, new AbortController().signal), 'unknown')
    assert.equal(await recoverMissingTask(pool, { async request() { return { status: 200, data: { name: 'wrong-queue' } } } }, input, new AbortController().signal), 'unknown')
    const controller = new AbortController()
    controller.abort()
    assert.equal(await recoverMissingTask(pool, fake(404), input, controller.signal), 'unknown')
    const timeout = AbortSignal.timeout(30)
    const hung = { async request() { return new Promise(() => {}) } }
    assert.equal(await recoverMissingTask(pool, hung, input, timeout), 'unknown')
    const delayed = { async request() { await new Promise(resolve => setTimeout(resolve, 80)); return { status: 200, data: { name: queue } } } }
    assert.equal(await recoverMissingTask(pool, delayed, input, AbortSignal.timeout(10)), 'unknown')
    await new Promise(resolve => setTimeout(resolve, 100))
    let row = (await pool.query('SELECT delivery_generation, published_at FROM outbox WHERE job_id = $1', [job.id])).rows[0]
    assert.equal(row.delivery_generation, 0)
    assert.ok(row.published_at)
    const concurrent = await Promise.all([recoverMissingTask(pool, fake(404), input, new AbortController().signal), recoverMissingTask(pool, fake(404), input, new AbortController().signal)])
    assert.deepEqual(concurrent.sort(), ['rearmed', 'unchanged'])
    row = (await pool.query('SELECT o.delivery_generation, o.published_at, j.scheduled_at, j.state FROM outbox o JOIN jobs j ON j.id = o.job_id WHERE j.id = $1', [job.id])).rows[0]
    assert.equal(row.delivery_generation, 1)
    assert.equal(row.published_at, null)
    assert.equal(row.state, 'pending')
    assert.equal(row.scheduled_at.getTime(), scheduledAt.getTime())
    assert.equal(await recoverMissingTask(pool, fake(404), input, new AbortController().signal), 'unchanged')
    await assert.rejects(recoverMissingTask(pool, fake(404), { ...input, jobId: 'bad-id' }, new AbortController().signal), /Invalid recovery target/)
    await pool.query("UPDATE outbox SET published_at = now(), lease_token = gen_random_uuid(), lease_until = now() + interval '1 minute' WHERE job_id = $1", [job.id])
    assert.equal(await recoverMissingTask(pool, fake(404), { ...input, generation: 1 }, new AbortController().signal), 'unchanged')
    await pool.query("UPDATE outbox SET lease_token = NULL, lease_until = NULL WHERE job_id = $1", [job.id])
    await pool.query("UPDATE jobs SET state = 'completed' WHERE id = $1", [job.id])
    assert.equal(await recoverMissingTask(pool, fake(404), { ...input, generation: 1 }, new AbortController().signal), 'unchanged')
  } finally { await pool.end() }
})
