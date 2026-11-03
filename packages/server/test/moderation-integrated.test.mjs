import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { claimVerifiedOwnership } from '../dist/verified-ownership.js'
import { evaluateTrustedShortcut, recordApprovedSubmission } from '../dist/approval-history.js'
import { executeModerationJob, recordAcceptedAssessment, recordAndDispatchAssessment } from '../dist/moderation-jobs.js'
import { dispatchJob, rearmMissingDelivery, reconcileOutbox } from '../dist/outbox.js'
import { placeModeratorHold, releaseModeratorHold } from '../dist/moderator-holds.js'
import { requestModeratorChanges, resolveModeratorChanges } from '../dist/moderator-change-requests.js'
import { escalateModerationRevision } from '../dist/moderator-escalations.js'
import { standardReviewWaitMilliseconds } from '../dist/moderation-schedule.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_') || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL must name a local disposable database beginning idea_map_test_')
}

// The policy callback, identity verifier, and dispatcher are synthetic. This is
// not an accepted scoring method or the disabled production worker execution path.
test('verified ownership, delayed delivery, independent review blocks, and publication compose under a controlled clock', async () => {
  const setup = new pg.Pool({ connectionString: url, max: 3 })
  let pool
  try {
    await migrate(drizzle(setup), { migrationsFolder: 'migrations' })
    await setup.query('CREATE SCHEMA integrated_clock')
    await setup.query('CREATE TABLE integrated_clock.current_time (at timestamptz NOT NULL)')
    await setup.query("INSERT INTO integrated_clock.current_time VALUES ('2030-01-01T00:00:00Z')")
    await setup.query("CREATE FUNCTION integrated_clock.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT at FROM integrated_clock.current_time'")
    pool = new pg.Pool({ connectionString: url, max: 8, options: '-c search_path=integrated_clock,public,pg_catalog' })
    const advance = value => setup.query('UPDATE integrated_clock.current_time SET at=$1', [value])
    const verifier = (uid, email) => ({
      async verifySessionCookie() { return { uid, email, email_verified: true, firebase: { sign_in_provider: 'password' } } },
      async getUser() { return { uid, email, emailVerified: true, disabled: false } },
    })
    const authorVerifier = verifier('synthetic-author', 'author@example.invalid')
    const moderatorVerifier = verifier('synthetic-moderator', 'moderator@example.invalid')
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','synthetic-moderator')", [moderator])
    await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic moderator')", [moderator])
    const modArgs = [url, 'demo-idea-map', 'synthetic-cookie', moderatorVerifier]
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('author@example.invalid') RETURNING id")).rows[0].id
    const createIdea = async () => (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id

    const prior = await createIdea()
    const priorRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content,review_state) VALUES ($1,1,'{}','approved') RETURNING id", [prior])).rows[0].id
    const priorTx = await pool.connect()
    try {
      await priorTx.query('BEGIN')
      await priorTx.query("UPDATE ideas SET publication_state='approved' WHERE id=$1", [prior])
      await priorTx.query('INSERT INTO approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [prior, priorRevision])
      await recordApprovedSubmission(priorTx, prior, priorRevision)
      await priorTx.query('COMMIT')
    } finally { priorTx.release() }
    assert.equal(await claimVerifiedOwnership(url, 'demo-idea-map', 'synthetic-cookie', authorVerifier, prior), 'processed')
    const idea = await createIdea()
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
    assert.equal(await claimVerifiedOwnership(url, 'demo-idea-map', 'synthetic-cookie', authorVerifier, idea), 'processed')
    const ownership = (await pool.query('SELECT user_id,verified_identity_id FROM ownership_claims WHERE idea_id=$1', [idea])).rows[0]
    const evidence = { userId: ownership.user_id, identityId: ownership.verified_identity_id, verifiedEmail: 'author@example.invalid', emailVerified: true }

    const t0 = new Date('2030-01-01T00:00:00Z')
    const input = { id: 'integrated-initial', revisionId: revision, fingerprint: 'a'.repeat(64), waitMilliseconds: standardReviewWaitMilliseconds(60), shortcutRequested: true }
    const sent = []
    const saved = await recordAndDispatchAssessment(pool, input, { async dispatch(job) { sent.push(job); throw new Error('synthetic lost response') } })
    assert.equal(saved.dispatchFailures, 2)
    assert.equal(saved.receivedAt.getTime(), t0.getTime())
    assert.equal(saved.deadline.getTime(), t0.getTime() + 86_400_000)
    const initialJobs = (await pool.query('SELECT id,kind FROM jobs WHERE assessment_id=$1', [input.id])).rows
    const oldShortcut = initialJobs.find(row => row.kind === 'moderation-shortcut').id
    await advance(new Date(t0.getTime() + 3_600_000))
    const repeated = await recordAcceptedAssessment(pool, input)
    assert.equal(repeated.receivedAt.getTime(), saved.receivedAt.getTime())
    assert.equal(repeated.deadline.getTime(), saved.deadline.getTime())
    assert.deepEqual(await reconcileOutbox(pool, { async dispatch(job) { sent.push(job) } }, 2), { attempted: 2, failed: 0 })
    for (const job of sent) assert.ok(saved.jobIds.includes(job.id))

    const review = { revisionId: revision, assessmentId: input.id, reason: 'Synthetic review' }
    assert.equal((await placeModeratorHold(...modArgs, { ...review, operationKey: 'integrated-hold' })).value, 'placed')
    assert.equal((await requestModeratorChanges(...modArgs, { ...review, operationKey: 'integrated-changes' })).value, 'requested')
    assert.equal((await escalateModerationRevision(...modArgs, { ...review, ownerId: moderator })).value, 'escalated')
    const holds = (await pool.query('SELECT id,kind FROM moderator_holds WHERE revision_id=$1', [revision])).rows
    const ordinary = holds.find(row => row.kind === 'hold').id
    const escalation = holds.find(row => row.kind === 'escalation').id
    const request = (await pool.query('SELECT id FROM moderator_change_requests WHERE idea_id=$1 AND resolved_at IS NULL', [idea])).rows[0].id
    const edited = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [idea])).rows[0].id
    const newInput = { ...input, id: 'integrated-edit', revisionId: edited, fingerprint: 'b'.repeat(64) }
    const next = await recordAcceptedAssessment(pool, newInput)
    const jobs = (await pool.query('SELECT id,kind FROM jobs WHERE assessment_id=$1', [newInput.id])).rows
    const shortcut = jobs.find(row => row.kind === 'moderation-shortcut').id
    const standard = jobs.find(row => row.kind === 'moderation-deadline').id
    assert.equal(await executeModerationJob(pool, oldShortcut, async () => 'allow'), 'stale')
    await assert.rejects(executeModerationJob(pool, shortcut, async () => 'allow'), /on hold/)
    const currentReview = { revisionId: edited, assessmentId: newInput.id, reason: 'Synthetic resolution' }
    assert.equal((await releaseModeratorHold(...modArgs, { ...currentReview, holdId: ordinary })).value, 'released')
    await assert.rejects(executeModerationJob(pool, shortcut, async () => 'allow'), /on hold/)
    assert.equal((await releaseModeratorHold(...modArgs, { ...currentReview, holdId: escalation })).value, 'released')
    await assert.rejects(executeModerationJob(pool, shortcut, async () => 'allow'), /changes are requested/)
    assert.equal((await resolveModeratorChanges(...modArgs, { ...currentReview, requestId: request })).value, 'resolved')
    assert.equal(await executeModerationJob(pool, shortcut, async client => {
      const trust = await evaluateTrustedShortcut(client, idea, evidence, 90.1)
      assert.deepEqual(trust, { eligible: false, priorApprovals: 1, threshold: 94.5 })
      return 'stale'
    }), 'stale')
    assert.equal((await pool.query('SELECT scheduled_at FROM jobs WHERE id=$1', [standard])).rows[0].scheduled_at.getTime(), next.deadline.getTime())
    await dispatchJob(pool, { async dispatch() {} }, standard)
    assert.equal(await rearmMissingDelivery(pool, standard, 0, async () => 'unknown'), false)
    assert.equal(await rearmMissingDelivery(pool, standard, 0, async () => 'absent'), true)
    let recovered
    await dispatchJob(pool, { async dispatch(job) { recovered = job } }, standard)
    assert.equal(recovered.deliveryGeneration, 1)
    assert.equal(recovered.scheduledAt.getTime(), next.deadline.getTime())
    assert.equal(await executeModerationJob(pool, standard, async () => 'allow'), 'not-due')
    await advance(next.deadline)
    for (const oldJob of saved.jobIds) assert.equal(await executeModerationJob(pool, oldJob, async () => 'allow'), oldJob === oldShortcut ? 'duplicate' : 'stale')
    assert.equal(await executeModerationJob(pool, standard, async () => 'allow'), 'completed')
    assert.equal(await executeModerationJob(pool, standard, async () => 'allow'), 'duplicate')
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id=$1', [idea])).rows[0].revision_id, edited)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_records WHERE idea_id=$1', [idea])).rows[0].n, 1)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [edited])).rows[0].n, 1)

    const immediateIdea = await createIdea()
    const immediateRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [immediateIdea])).rows[0].id
    const immediate = await recordAcceptedAssessment(pool, { id: 'integrated-immediate', revisionId: immediateRevision, fingerprint: 'e'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    assert.equal(immediate.deadline.getTime(), immediate.receivedAt.getTime())
    assert.equal(await executeModerationJob(pool, immediate.jobIds[0], async () => 'allow'), 'completed')
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [immediateRevision])).rows[0].n, 1)

    const rollbackIdea = await createIdea()
    const rollbackRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [rollbackIdea])).rows[0].id
    const rollback = await recordAcceptedAssessment(pool, { id: 'integrated-projection-collision', revisionId: rollbackRevision, fingerprint: 'd'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    await pool.query("INSERT INTO jobs(kind,idempotency_key,scheduled_at) VALUES ('synthetic-collision',$1,clock_timestamp())", [`projection:${rollbackRevision}:integrated-projection-collision`])
    await assert.rejects(executeModerationJob(pool, rollback.jobIds[0], async () => 'allow'), /conflict/i)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [rollbackIdea])).rows[0].publication_state, 'private')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approved_revisions WHERE idea_id=$1', [rollbackIdea])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_records WHERE idea_id=$1', [rollbackIdea])).rows[0].n, 0)

    const manualIdea = await createIdea()
    const manualRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [manualIdea])).rows[0].id
    const manual = await recordAcceptedAssessment(pool, { id: 'integrated-incomplete', revisionId: manualRevision, fingerprint: 'c'.repeat(64), waitMilliseconds: null, shortcutRequested: false })
    assert.equal(manual.deadline, null)
    assert.deepEqual(manual.jobIds, [])
  } finally { if (pool) await pool.end(); await setup.end() }
})
