import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { placeModeratorHold, releaseModeratorHold } from '../dist/moderator-holds.js'
import { recordAcceptedAssessment, executeModerationJob } from '../dist/moderation-jobs.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('authorized holds serialize with publication and do not release unrelated blocks', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const administrator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','synthetic-moderator')", [moderator])
    await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$2,'synthetic grant')", [moderator, administrator])
    const session = { uid: 'synthetic-moderator', email: 'moderator@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verify = { async verifySessionCookie() { return session }, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: false } } }
    const unprivileged = { ...verify, async verifySessionCookie() { return { ...session, uid: 'other' } }, async getUser() { return { uid: 'other', email: session.email, emailVerified: true, disabled: false } } }
    const args = [url, 'demo-idea-map', 'synthetic-cookie', verify]
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('hold@example.invalid') RETURNING id")).rows[0].id
    const create = async id => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      await recordAcceptedAssessment(pool, { id, revisionId: revision, fingerprint: 'a'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
      const job = (await pool.query('SELECT id FROM jobs WHERE assessment_id=$1', [id])).rows[0].id
      return { idea, revision, job, request: { revisionId: revision, assessmentId: id, reason: 'Synthetic review' } }
    }
    const held = await create('hold-first')
    assert.deepEqual(await placeModeratorHold(url, 'demo-idea-map', 'synthetic-cookie', unprivileged, held.request), { state: 'forbidden' })
    let lookups = 0
    const disabledBeforeCommit = { ...verify, async getUser() {
      return { uid: session.uid, email: session.email, emailVerified: true, disabled: ++lookups > 1 }
    } }
    assert.deepEqual(await placeModeratorHold(url, 'demo-idea-map', 'synthetic-cookie', disabledBeforeCommit, held.request), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1', [held.revision])).rows[0].n, 0)
    lookups = 0
    const providerFailureBeforeCommit = { ...verify, async getUser() {
      if (++lookups > 1) throw new Error('synthetic provider failure')
      return { uid: session.uid, email: session.email, emailVerified: true, disabled: false }
    } }
    await assert.rejects(placeModeratorHold(url, 'demo-idea-map', 'synthetic-cookie', providerFailureBeforeCommit, held.request), /Identity verification unavailable/)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1', [held.revision])).rows[0].n, 0)
    lookups = 0
    const providerTimeoutBeforeCommit = { ...verify, async getUser() {
      if (++lookups > 1) return new Promise(() => {})
      return { uid: session.uid, email: session.email, emailVerified: true, disabled: false }
    } }
    await assert.rejects(placeModeratorHold(url, 'demo-idea-map', 'synthetic-cookie', providerTimeoutBeforeCommit, held.request), /Identity recheck timed out/)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1', [held.revision])).rows[0].n, 0)
    assert.deepEqual(await placeModeratorHold(...args, { ...held.request, assessmentId: 'stale' }), { state: 'authorized', value: 'stale' })
    assert.deepEqual(await placeModeratorHold(...args, held.request), { state: 'authorized', value: 'placed' })
    assert.deepEqual(await placeModeratorHold(...args, held.request), { state: 'authorized', value: 'already-held' })
    const hold = (await pool.query('SELECT * FROM moderator_holds WHERE revision_id=$1', [held.revision])).rows[0]
    assert.equal(hold.placed_by, moderator)
    assert.equal(hold.reason, 'Synthetic review')
    await assert.rejects(executeModerationJob(pool, held.job, async () => 'allow'), /on hold/)
    await pool.query('UPDATE review_gates SET blocked=true WHERE revision_id=$1', [held.revision])
    assert.deepEqual(await releaseModeratorHold(...args, { ...held.request, holdId: hold.id, reason: 'Review completed' }), { state: 'authorized', value: 'released' })
    const released = (await pool.query('SELECT * FROM moderator_holds WHERE id=$1', [hold.id])).rows[0]
    assert.equal(released.released_by, moderator)
    assert.equal(released.release_reason, 'Review completed')
    assert.deepEqual(await releaseModeratorHold(...args, { ...held.request, holdId: hold.id }), { state: 'authorized', value: 'not-held' })
    await assert.rejects(executeModerationJob(pool, held.job, async () => 'allow'), /on hold/)
    await pool.query('UPDATE review_gates SET blocked=false WHERE revision_id=$1', [held.revision])
    assert.equal(await executeModerationJob(pool, held.job, async () => 'allow'), 'completed')
    assert.deepEqual(await placeModeratorHold(...args, held.request), { state: 'authorized', value: 'stale' })
    await assert.rejects(placeModeratorHold(...args, { ...held.request, reason: '  ' }), /Invalid/)

    const edited = await create('edited')
    await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}')", [edited.idea])
    assert.deepEqual(await placeModeratorHold(...args, edited.request), { state: 'authorized', value: 'stale' })
    const replaced = await create('before-replacement')
    await recordAcceptedAssessment(pool, { id: 'after-replacement', revisionId: replaced.revision, fingerprint: 'b'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    assert.deepEqual(await placeModeratorHold(...args, replaced.request), { state: 'authorized', value: 'stale' })

    const superseded = await create('held-before-replacement')
    assert.deepEqual(await placeModeratorHold(...args, superseded.request), { state: 'authorized', value: 'placed' })
    const supersededHold = (await pool.query('SELECT id FROM moderator_holds WHERE revision_id=$1', [superseded.revision])).rows[0].id
    await recordAcceptedAssessment(pool, { id: 'held-after-replacement', revisionId: superseded.revision, fingerprint: 'b'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    const currentJob = (await pool.query("SELECT id FROM jobs WHERE assessment_id='held-after-replacement'")).rows[0].id
    await assert.rejects(executeModerationJob(pool, currentJob, async () => 'allow'), /on hold/)
    assert.deepEqual(await releaseModeratorHold(...args, { ...superseded.request, holdId: supersededHold }), { state: 'authorized', value: 'stale' })
    assert.deepEqual(await releaseModeratorHold(...args, { ...superseded.request, assessmentId: 'held-after-replacement', holdId: supersededHold }), { state: 'authorized', value: 'released' })

    const editedHold = await create('held-before-edit')
    assert.deepEqual(await placeModeratorHold(...args, editedHold.request), { state: 'authorized', value: 'placed' })
    const editedHoldId = (await pool.query('SELECT id FROM moderator_holds WHERE revision_id=$1', [editedHold.revision])).rows[0].id
    const newRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [editedHold.idea])).rows[0].id
    const newAssessment = await recordAcceptedAssessment(pool, { id: 'held-after-edit', revisionId: newRevision, fingerprint: 'c'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    await assert.rejects(executeModerationJob(pool, newAssessment.jobIds[0], async () => 'allow'), /on hold/)
    assert.deepEqual(await releaseModeratorHold(...args, { ...editedHold.request, holdId: editedHoldId }), { state: 'authorized', value: 'stale' })
    const unrelated = await create('unrelated-release')
    assert.deepEqual(await releaseModeratorHold(...args, { ...unrelated.request, holdId: editedHoldId }), { state: 'authorized', value: 'not-held' })
    assert.deepEqual(await releaseModeratorHold(...args, { ...editedHold.request, revisionId: newRevision, assessmentId: 'held-after-edit', holdId: editedHoldId }), { state: 'authorized', value: 'released' })
    assert.equal(await executeModerationJob(pool, newAssessment.jobIds[0], async () => 'allow'), 'completed')
    const rejectedHold = await create('held-then-rejected')
    assert.deepEqual(await placeModeratorHold(...args, rejectedHold.request), { state: 'authorized', value: 'placed' })
    const rejectedHoldId = (await pool.query('SELECT id FROM moderator_holds WHERE revision_id=$1', [rejectedHold.revision])).rows[0].id
    await pool.query("UPDATE idea_revisions SET review_state='rejected' WHERE id=$1", [rejectedHold.revision])
    assert.deepEqual(await releaseModeratorHold(...args, { ...rejectedHold.request, holdId: rejectedHoldId }), { state: 'authorized', value: 'released' })
    assert.equal(await executeModerationJob(pool, rejectedHold.job, async () => 'allow'), 'stale')

    const waiting = await create('committed-hold-race')
    const transaction = await pool.connect()
    const stricterDefault = new pg.Pool({ connectionString: url, max: 1 })
    try {
      await stricterDefault.query("SET default_transaction_isolation = 'repeatable read'")
      assert.equal((await stricterDefault.query('SHOW default_transaction_isolation')).rows[0].default_transaction_isolation, 'repeatable read')
      await transaction.query('BEGIN')
      await transaction.query('SELECT id FROM ideas WHERE id=$1 FOR UPDATE', [waiting.idea])
      await transaction.query("INSERT INTO moderator_holds(revision_id,placed_by,reason) VALUES ($1,$2,'Synthetic committed hold')", [waiting.revision, moderator])
      const publication = executeModerationJob(stricterDefault, waiting.job, async () => 'allow')
      assert.equal(await Promise.race([publication.then(() => 'finished', () => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await transaction.query('COMMIT')
      await assert.rejects(publication, /on hold/)
      assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [waiting.idea])).rows[0].publication_state, 'private')
    } finally { await transaction.query('ROLLBACK'); transaction.release(); await stricterDefault.end() }

    for (let n = 0; n < 6; n++) {
      const item = await create(`race-${n}`)
      const [placement, publication] = await Promise.all([
        placeModeratorHold(...args, item.request),
        executeModerationJob(pool, item.job, async () => 'allow').catch(error => { if (!/on hold/.test(error.message)) throw error; return 'held' }),
      ])
      assert.ok((placement.value === 'placed' && publication === 'held') || (placement.value === 'stale' && publication === 'completed'))
      const active = (await pool.query('SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1 AND released_at IS NULL', [item.revision])).rows[0].n
      assert.equal(active, placement.value === 'placed' ? 1 : 0)
    }
  } finally { await pool.end() }
})
