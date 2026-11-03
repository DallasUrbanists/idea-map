import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { recordAcceptedAssessment, executeModerationJob } from '../dist/moderation-jobs.js'
import { createJobIntent, dispatchJob, reconcileOutbox, rearmMissingDelivery } from '../dist/outbox.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('assessment receipt, deadline, publication and recovery remain revision safe', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 6 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('moderation@example.invalid') RETURNING id")).rows[0].id
    const createIdea = async () => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      return { idea, revision }
    }
    const fingerprint = 'a'.repeat(64)
    const first = await createIdea()
    const input = { id: 'immediate-assessment', revisionId: first.revision, fingerprint, waitMilliseconds: 0, shortcutRequested: false }
    const accepted = await recordAcceptedAssessment(pool, input)
    const duplicate = await recordAcceptedAssessment(pool, input)
    assert.equal(accepted.inserted, true)
    assert.equal(duplicate.inserted, false)
    assert.equal(accepted.receivedAt.getTime(), duplicate.receivedAt.getTime())
    assert.equal(accepted.deadline.getTime(), accepted.receivedAt.getTime())
    await assert.rejects(recordAcceptedAssessment(pool, { ...input, fingerprint: 'b'.repeat(64) }), /conflicts/)
    const immediate = (await pool.query("SELECT id FROM jobs WHERE assessment_id = $1 AND kind = 'moderation-deadline'", [input.id])).rows[0].id
    const deliveries = []
    await assert.rejects(dispatchJob(pool, { async dispatch(job) { deliveries.push(job); throw new Error('unknown result') } }, immediate), /unknown result/)
    assert.deepEqual(await reconcileOutbox(pool, { async dispatch(job) { deliveries.push(job) } }, 1), { attempted: 1, failed: 0 })
    assert.equal(deliveries[0].id, deliveries[1].id)
    assert.equal(deliveries[1].scheduledAt.getTime(), accepted.deadline.getTime())
    const results = await Promise.all([executeModerationJob(pool, immediate, async () => 'allow'), executeModerationJob(pool, immediate, async () => 'allow')])
    assert.deepEqual(results.sort(), ['completed', 'duplicate'])
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id = $1', [first.idea])).rows[0].revision_id, first.revision)
    assert.deepEqual((await pool.query('SELECT revision_id, verified_for_trust FROM approval_records WHERE idea_id = $1', [first.idea])).rows, [{ revision_id: first.revision, verified_for_trust: true }])
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind = 'projection' AND revision_id = $1", [first.revision])).rows[0].n, 1)
    await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}')", [first.idea])
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id = $1', [first.idea])).rows[0].revision_id, first.revision)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id = $1', [first.idea])).rows[0].publication_state, 'approved')

    const pending = await createIdea()
    const delayed = { id: 'delayed-assessment', revisionId: pending.revision, fingerprint, waitMilliseconds: 86_400_000, shortcutRequested: true }
    const saved = await recordAcceptedAssessment(pool, delayed)
    assert.equal(saved.deadline.getTime() - saved.receivedAt.getTime(), 86_400_000)
    // Conflicting retries must not alter either eligible revision or its durable work.
    const otherEligible = await createIdea()
    await recordAcceptedAssessment(pool, { ...delayed, id: 'other-eligible-assessment', revisionId: otherEligible.revision,
      waitMilliseconds: null, shortcutRequested: false })
    const revisionIds = [pending.revision, otherEligible.revision]
    const durableState = async () => ({
      ideas: (await pool.query('SELECT * FROM ideas WHERE id = ANY($1::uuid[]) ORDER BY id', [[pending.idea, otherEligible.idea]])).rows,
      revisions: (await pool.query('SELECT * FROM idea_revisions WHERE id = ANY($1::uuid[]) ORDER BY id', [revisionIds])).rows,
      assessments: (await pool.query('SELECT * FROM revision_assessments WHERE revision_id = ANY($1::uuid[]) ORDER BY id', [revisionIds])).rows,
      gates: (await pool.query('SELECT * FROM review_gates WHERE revision_id = ANY($1::uuid[]) ORDER BY revision_id', [revisionIds])).rows,
      jobs: (await pool.query('SELECT * FROM jobs WHERE revision_id = ANY($1::uuid[]) ORDER BY id', [revisionIds])).rows,
      outbox: (await pool.query(`SELECT o.* FROM outbox o JOIN jobs j ON j.id = o.job_id
        WHERE j.revision_id = ANY($1::uuid[]) ORDER BY o.id`, [revisionIds])).rows,
    })
    const beforeConflicts = await durableState()
    assert.equal(beforeConflicts.assessments.length, 2)
    assert.ok(beforeConflicts.assessments.every(assessment => assessment.current))
    assert.equal(beforeConflicts.jobs.length, 2)
    assert.equal(beforeConflicts.outbox.length, 2)
    for (const [field, change] of [
      ['revisionId', { revisionId: otherEligible.revision }],
      ['waitMilliseconds', { waitMilliseconds: 43_200_000 }],
      ['shortcutRequested', { shortcutRequested: false }],
    ]) {
      await assert.rejects(recordAcceptedAssessment(pool, { ...delayed, ...change }),
        /Assessment identity conflicts with existing evidence/, field)
      assert.deepEqual(await durableState(), beforeConflicts, `${field} conflict preserves durable state`)
      assert.deepEqual(await recordAcceptedAssessment(pool, delayed), { ...saved, inserted: false },
        `${field} conflict leaves the original assessment replayable`)
      assert.deepEqual(await durableState(), beforeConflicts, `${field} replay preserves durable state`)
    }
    const jobs = (await pool.query('SELECT id, kind FROM jobs WHERE assessment_id = $1', [delayed.id])).rows
    const standard = jobs.find(job => job.kind === 'moderation-deadline').id
    const shortcut = jobs.find(job => job.kind === 'moderation-shortcut').id
    assert.equal(await executeModerationJob(pool, shortcut, async () => 'stale'), 'stale')
    assert.equal(await executeModerationJob(pool, standard, async () => 'allow'), 'not-due')
    assert.equal((await pool.query('SELECT scheduled_at FROM jobs WHERE id = $1', [standard])).rows[0].scheduled_at.getTime(), saved.deadline.getTime())
    await dispatchJob(pool, { async dispatch() {} }, standard)
    assert.equal(await rearmMissingDelivery(pool, standard, 0, async () => 'unknown'), false)
    assert.equal(await rearmMissingDelivery(pool, standard, 0, async () => 'present'), false)
    assert.equal(await rearmMissingDelivery(pool, standard, 0, async () => 'absent'), true)
    assert.equal(await rearmMissingDelivery(pool, standard, 0, async () => 'absent'), false)
    let redelivery
    await dispatchJob(pool, { async dispatch(job) { redelivery = job } }, standard)
    assert.equal(redelivery.deliveryGeneration, 1)
    assert.equal(redelivery.scheduledAt.getTime(), saved.deadline.getTime())
    const uncertain = (await createJobIntent(pool, { idempotencyKey: 'uncertain-delivery', kind: 'test', scheduledAt: new Date() }, async () => {})).job
    for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(dispatchJob(pool, { async dispatch() { throw new Error('uncertain') } }, uncertain.id), /uncertain/)
    assert.equal(await rearmMissingDelivery(pool, uncertain.id, 0, async () => 'absent'), true)
    await dispatchJob(pool, { async dispatch(job) { redelivery = job } }, uncertain.id)
    assert.equal(redelivery.deliveryGeneration, 1)

    const fallback = await createIdea()
    const fallbackAssessment = await recordAcceptedAssessment(pool, { ...input, id: 'shortcut-fallback', revisionId: fallback.revision, waitMilliseconds: 1500, shortcutRequested: true })
    const fallbackJobs = (await pool.query('SELECT id, kind FROM jobs WHERE assessment_id = $1', ['shortcut-fallback'])).rows
    const fallbackShortcut = fallbackJobs.find(job => job.kind === 'moderation-shortcut').id
    const fallbackStandard = fallbackJobs.find(job => job.kind === 'moderation-deadline').id
    assert.equal(await executeModerationJob(pool, fallbackShortcut, async () => 'stale'), 'stale')
    assert.equal((await pool.query('SELECT scheduled_at FROM jobs WHERE id = $1', [fallbackStandard])).rows[0].scheduled_at.getTime(), fallbackAssessment.deadline.getTime())
    await new Promise(resolve => setTimeout(resolve, Math.max(0, fallbackAssessment.deadline.getTime() - Date.now() + 100)))
    assert.equal(await executeModerationJob(pool, fallbackStandard, async () => 'allow'), 'completed')

    const replaced = await createIdea()
    await recordAcceptedAssessment(pool, { ...input, id: 'first-version', revisionId: replaced.revision })
    const oldJob = (await pool.query("SELECT id FROM jobs WHERE assessment_id = 'first-version'")).rows[0].id
    await recordAcceptedAssessment(pool, { ...input, id: 'replacement', revisionId: replaced.revision })
    assert.equal(await executeModerationJob(pool, oldJob, async () => 'allow'), 'stale')
    const replacement = (await pool.query("SELECT id FROM jobs WHERE assessment_id = 'replacement'")).rows[0].id
    const newer = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [replaced.idea])).rows[0].id
    assert.equal(await executeModerationJob(pool, replacement, async () => 'allow'), 'stale')

    const held = await createIdea()
    await recordAcceptedAssessment(pool, { ...input, id: 'held', revisionId: held.revision })
    const heldJob = (await pool.query("SELECT id FROM jobs WHERE assessment_id = 'held'")).rows[0].id
    const moderator = await pool.connect()
    try {
      await moderator.query('BEGIN')
      await moderator.query('SELECT id FROM ideas WHERE id = $1 FOR UPDATE', [held.idea])
      await moderator.query('UPDATE review_gates SET blocked = true WHERE revision_id = $1', [held.revision])
      const approval = executeModerationJob(pool, heldJob, async () => 'allow')
      await moderator.query('COMMIT')
      await assert.rejects(approval, /on hold/)
    } finally { moderator.release() }
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id = $1', [held.idea])).rows[0].publication_state, 'private')
    assert.equal((await pool.query('SELECT state FROM jobs WHERE id = $1', [heldJob])).rows[0].state, 'pending')
    await pool.query('UPDATE review_gates SET blocked = false WHERE revision_id = $1', [held.revision])
    assert.equal(await executeModerationJob(pool, heldJob, async () => 'allow'), 'completed')
    const retry = await createIdea()
    await recordAcceptedAssessment(pool, { ...input, id: 'policy-unavailable', revisionId: retry.revision })
    const retryJob = (await pool.query("SELECT id FROM jobs WHERE assessment_id = 'policy-unavailable'")).rows[0].id
    await assert.rejects(executeModerationJob(pool, retryJob, async () => 'retry'), /unavailable/)
    assert.equal((await pool.query('SELECT state FROM jobs WHERE id = $1', [retryJob])).rows[0].state, 'pending')
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id = $1', [retry.idea])).rows[0].publication_state, 'private')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_records WHERE idea_id = $1', [retry.idea])).rows[0].n, 0)
    assert.equal(await executeModerationJob(pool, retryJob, async () => 'allow'), 'completed')
    const rollback = await createIdea()
    await recordAcceptedAssessment(pool, { ...input, id: 'projection-collision', revisionId: rollback.revision })
    const rollbackJob = (await pool.query("SELECT id FROM jobs WHERE assessment_id = 'projection-collision'")).rows[0].id
    await pool.query("INSERT INTO jobs (kind, idempotency_key, scheduled_at) VALUES ('test', $1, now())", [`projection:${rollback.revision}:projection-collision`])
    await assert.rejects(executeModerationJob(pool, rollbackJob, async () => 'allow'), /conflict/i)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id = $1', [rollback.idea])).rows[0].publication_state, 'private')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_records WHERE idea_id = $1', [rollback.idea])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approved_revisions WHERE idea_id = $1', [rollback.idea])).rows[0].n, 0)
    const manual = await createIdea()
    const noTimer = await recordAcceptedAssessment(pool, { ...input, id: 'human-review', revisionId: manual.revision, waitMilliseconds: null })
    assert.equal(noTimer.deadline, null)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE assessment_id = 'human-review'")).rows[0].n, 0)
    const conflict = await createIdea()
    await pool.query("INSERT INTO jobs (revision_id, kind, idempotency_key, assessment_id, assessment_received_at, scheduled_at) VALUES ($1, 'moderation-deadline', 'synthetic-collision', 'conflict', now(), now())", [conflict.revision])
    await assert.rejects(recordAcceptedAssessment(pool, { ...input, id: 'conflict', revisionId: conflict.revision }), { code: '23505' })
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM revision_assessments WHERE id = 'conflict'")).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM review_gates WHERE revision_id = $1', [conflict.revision])).rows[0].n, 0)
    assert.ok(newer)
  } finally { await pool.end() }
})
