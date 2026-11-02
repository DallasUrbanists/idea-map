import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { recordAcceptedAssessment, recordAndDispatchAssessment, executeModerationJob } from '../dist/moderation-jobs.js'
import { reconcileOutbox } from '../dist/outbox.js'
import { standardReviewWaitMilliseconds } from '../dist/moderation-schedule.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_') || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL must name a local disposable database beginning idea_map_test_')
}

test('controlled receipt and delivery time preserves the review deadline and atomic publication', async () => {
  const setup = new pg.Pool({ connectionString: url, max: 2 })
  let pool
  try {
    await migrate(drizzle(setup), { migrationsFolder: 'migrations' })
    await setup.query('CREATE SCHEMA clock_fixture')
    await setup.query("CREATE TABLE clock_fixture.current_time (at timestamptz NOT NULL)")
    await setup.query("INSERT INTO clock_fixture.current_time VALUES ('2030-01-01T00:00:00Z')")
    await setup.query("CREATE FUNCTION clock_fixture.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT at FROM clock_fixture.current_time'")
    pool = new pg.Pool({ connectionString: url, max: 6, options: '-c search_path=clock_fixture,public,pg_catalog' })
    const now = () => pool.query('SELECT clock_timestamp() AS at').then(result => result.rows[0].at)
    const advance = at => setup.query('UPDATE clock_fixture.current_time SET at = $1', [at])
    const t0 = new Date('2030-01-01T00:00:00Z')
    assert.equal((await now()).getTime(), t0.getTime())
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('clock@example.invalid') RETURNING id")).rows[0].id
    const createRevision = async () => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      return { idea, revision }
    }
    const target = await createRevision()
    const input = { id: 'clock-delay', revisionId: target.revision, fingerprint: 'a'.repeat(64),
      waitMilliseconds: standardReviewWaitMilliseconds(60), shortcutRequested: false }
    const attempted = []
    const saved = await recordAndDispatchAssessment(pool, input, { async dispatch(job) { attempted.push(job); throw new Error('lost response') } })
    assert.equal(saved.dispatchFailures, 1)
    assert.equal(saved.receivedAt.getTime(), t0.getTime())
    assert.equal(saved.deadline.getTime(), t0.getTime() + 86_400_000)
    assert.equal(saved.jobIds.length, 1)
    assert.equal(await executeModerationJob(pool, saved.jobIds[0], async () => 'allow'), 'not-due')
    await advance(new Date(t0.getTime() + 3_600_000))
    const duplicate = await recordAcceptedAssessment(pool, input)
    assert.equal(duplicate.inserted, false)
    assert.equal(duplicate.receivedAt.getTime(), saved.receivedAt.getTime())
    assert.equal(duplicate.deadline.getTime(), saved.deadline.getTime())
    assert.deepEqual(await reconcileOutbox(pool, { async dispatch(job) { attempted.push(job) } }, 1), { attempted: 1, failed: 0 })
    assert.equal(attempted[0].id, attempted[1].id)
    assert.equal(attempted[1].scheduledAt.getTime(), saved.deadline.getTime())
    await advance(new Date(saved.deadline.getTime() - 1))
    assert.equal(await executeModerationJob(pool, saved.jobIds[0], async () => 'allow'), 'not-due')
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [target.idea])).rows[0].publication_state, 'private')
    await advance(saved.deadline)
    assert.equal(await executeModerationJob(pool, saved.jobIds[0], async () => 'allow'), 'completed')
    assert.equal(await executeModerationJob(pool, saved.jobIds[0], async () => 'allow'), 'duplicate')
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id=$1', [target.idea])).rows[0].revision_id, target.revision)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [target.revision])).rows[0].n, 1)
    const immediate = await createRevision()
    const instant = await recordAcceptedAssessment(pool, { ...input, id: 'clock-immediate', revisionId: immediate.revision,
      waitMilliseconds: standardReviewWaitMilliseconds(95) })
    assert.equal(instant.receivedAt.getTime(), saved.deadline.getTime())
    assert.equal(instant.deadline.getTime(), instant.receivedAt.getTime())
    assert.equal(await executeModerationJob(pool, instant.jobIds[0], async () => 'allow'), 'completed')

    const replace = await createRevision()
    const old = await recordAcceptedAssessment(pool, { ...input, id: 'clock-old', revisionId: replace.revision })
    await advance(new Date(old.receivedAt.getTime() + 3_600_000))
    const newer = await recordAcceptedAssessment(pool, { ...input, id: 'clock-new', revisionId: replace.revision })
    assert.equal(newer.deadline.getTime() - old.deadline.getTime(), 3_600_000)
    await advance(old.deadline)
    assert.equal(await executeModerationJob(pool, old.jobIds[0], async () => 'allow'), 'stale')
    assert.equal(await executeModerationJob(pool, newer.jobIds[0], async () => 'allow'), 'not-due')
    await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}')", [replace.idea])
    await advance(newer.deadline)
    assert.equal(await executeModerationJob(pool, newer.jobIds[0], async () => 'allow'), 'stale')
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [replace.idea])).rows[0].publication_state, 'private')

    const shortcut = await createRevision()
    const shortcutAssessment = await recordAcceptedAssessment(pool, { ...input, id: 'clock-shortcut', revisionId: shortcut.revision, shortcutRequested: true })
    const jobs = (await pool.query('SELECT id, kind FROM jobs WHERE assessment_id=$1', ['clock-shortcut'])).rows
    const shortcutJob = jobs.find(row => row.kind === 'moderation-shortcut').id
    const standardJob = jobs.find(row => row.kind === 'moderation-deadline').id
    assert.equal(await executeModerationJob(pool, shortcutJob, async () => 'stale'), 'stale')
    assert.equal(await executeModerationJob(pool, standardJob, async () => 'allow'), 'not-due')
    await advance(shortcutAssessment.deadline)
    assert.equal(await executeModerationJob(pool, standardJob, async () => 'allow'), 'completed')

    const held = await createRevision()
    const heldAssessment = await recordAcceptedAssessment(pool, { ...input, id: 'clock-held', revisionId: held.revision, waitMilliseconds: 0 })
    const moderator = await pool.connect()
    let execution
    try {
      await moderator.query('BEGIN')
      const pid = (await moderator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      await moderator.query('SELECT id FROM ideas WHERE id=$1 FOR UPDATE', [held.idea])
      await moderator.query('UPDATE review_gates SET blocked=true WHERE revision_id=$1', [held.revision])
      execution = executeModerationJob(pool, heldAssessment.jobIds[0], async () => 'allow')
        .then(value => ({ value }), error => ({ error }))
      let waiting = false
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (await setup.query('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked', [pid])).rows[0].blocked
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.ok(waiting, 'publication must wait for the moderator lock')
      await moderator.query('COMMIT')
      assert.match((await execution).error?.message ?? '', /on hold/)
    } finally {
      await moderator.query('ROLLBACK')
      moderator.release()
      if (execution) await execution
    }
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [held.idea])).rows[0].publication_state, 'private')
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [held.revision])).rows[0].n, 0)

    const manual = await createRevision()
    const manualAssessment = await recordAcceptedAssessment(pool, { ...input, id: 'clock-manual', revisionId: manual.revision, waitMilliseconds: null })
    assert.equal(manualAssessment.deadline, null)
    assert.deepEqual(manualAssessment.jobIds, [])

    const rollback = await createRevision()
    const rollbackAssessment = await recordAcceptedAssessment(pool, { ...input, id: 'clock-rollback', revisionId: rollback.revision, waitMilliseconds: 0 })
    await pool.query("INSERT INTO jobs(kind,idempotency_key,scheduled_at) VALUES ('test',$1,now())", [`projection:${rollback.revision}:clock-rollback`])
    await assert.rejects(executeModerationJob(pool, rollbackAssessment.jobIds[0], async () => 'allow'), /conflict/i)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [rollback.idea])).rows[0].publication_state, 'private')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approved_revisions WHERE idea_id=$1', [rollback.idea])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_records WHERE idea_id=$1', [rollback.idea])).rows[0].n, 0)
  } finally {
    if (pool) await pool.end()
    await setup.end()
  }
})
