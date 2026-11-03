import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import pg from 'pg'
import { recordAcceptedAssessment } from '@idea-map/server'
import { inspectJob } from '../dist/inspect-job.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('A disposable test database is required')

test('read-only job inspection reports assessment, dispatch and lease state without changing it', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 })
  try {
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('inspection@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
    const assessment = await recordAcceptedAssessment(pool, { id: 'inspection-assessment', revisionId: revision,
      fingerprint: 'c'.repeat(64), waitMilliseconds: 86400000, shortcutRequested: false })
    const id = assessment.jobIds[0]
    const state = async () => (await pool.query('SELECT row_to_json(j) AS job, row_to_json(o) AS outbox, row_to_json(a) AS assessment FROM jobs j JOIN outbox o ON o.job_id=j.id JOIN revision_assessments a ON a.id=j.assessment_id WHERE j.id=$1', [id])).rows[0]
    let before = await state()
    let snapshot = await inspectJob(pool, id)
    assert.equal(snapshot.job_id, id)
    assert.equal(snapshot.revision_id, revision)
    assert.equal(snapshot.assessment_id, 'inspection-assessment')
    assert.equal(snapshot.assessment_received_at.getTime(), assessment.receivedAt.getTime())
    assert.equal(snapshot.assessment_deadline.getTime(), assessment.deadline.getTime())
    assert.equal(snapshot.scheduled_at.getTime(), assessment.deadline.getTime())
    assert.equal(snapshot.lease_status, 'none')
    assert.equal(snapshot.acknowledged_at, null)
    assert.deepEqual(await state(), before)
    for (const [interval, expected] of [['1 hour', 'active'], ['-1 hour', 'expired']]) {
      await pool.query(`UPDATE outbox SET lease_token=gen_random_uuid(), lease_until=clock_timestamp()+$2::interval,
        published_at=clock_timestamp(), dispatch_attempts=5, delivery_generation=2 WHERE job_id=$1`, [id, interval])
      before = await state()
      snapshot = await inspectJob(pool, id)
      assert.equal(snapshot.lease_status, expected)
      assert.equal(snapshot.dispatch_attempts, 5)
      assert.equal(snapshot.delivery_generation, 2)
      assert.ok(snapshot.acknowledged_at)
      assert.deepEqual(await state(), before)
    }
    assert.equal(await inspectJob(pool, '11111111-1111-4111-8111-111111111111'), null)
    await assert.rejects(inspectJob(pool, 'not-a-uuid'), /Invalid job ID/)
    const unpaired = (await pool.query("INSERT INTO jobs(kind,idempotency_key) VALUES ('synthetic','inspect-no-outbox') RETURNING id")).rows[0].id
    assert.equal((await inspectJob(pool, unpaired)).lease_status, 'no-outbox')
    const result = spawnSync(process.execPath, ['dist/inspect-job-cli.js', '--job', id], {
      env: { ...process.env, WORKER_PROVIDER_MODE: 'offline', WORKER_DATABASE_URL: url }, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).snapshot.job_id, id)
    assert.doesNotMatch(result.stdout + result.stderr, /inspection@example|local-only|postgres:\/\//)
    const missing = spawnSync(process.execPath, ['dist/inspect-job-cli.js', '--job', '11111111-1111-4111-8111-111111111111'], {
      env: { ...process.env, WORKER_PROVIDER_MODE: 'offline', WORKER_DATABASE_URL: url }, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(missing.status, 2)
    assert.match(missing.stderr, /Job not found/)
    assert.doesNotMatch(missing.stdout + missing.stderr, /local-only|postgres:\/\//)
    assert.deepEqual(await state(), before)
  } finally { await pool.end() }
})
