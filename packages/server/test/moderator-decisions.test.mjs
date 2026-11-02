import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { rejectModerationRevision } from '../dist/moderator-decisions.js'
import { executeModerationJob, recordAcceptedAssessment } from '../dist/moderation-jobs.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('authorized rejections are revision-safe, atomic, and serialize with timed publication', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `decision_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const actor = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator')", [actor])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic grant') RETURNING id", [actor])).rows[0].id
    const session = { uid: 'moderator', email: 'moderator@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verify = { async verifySessionCookie() { return session }, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: false } } }
    const other = { ...verify, async verifySessionCookie() { return { ...session, uid: 'other' } }, async getUser() { return { uid: 'other', email: session.email, emailVerified: true, disabled: false } } }
    const args = [url, 'demo-idea-map', 'synthetic-cookie', verify]
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('decision@example.invalid') RETURNING id")).rows[0].id
    const create = async id => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      const result = await recordAcceptedAssessment(pool, { id, revisionId: revision, fingerprint: 'a'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
      return { idea, revision, job: result.jobIds[0], input: { revisionId: revision, assessmentId: id, reason: 'Synthetic decision' } }
    }
    const target = await create('decision-first')
    assert.deepEqual(await rejectModerationRevision(url, 'demo-idea-map', 'synthetic-cookie', other, target.input), { state: 'forbidden' })
    assert.deepEqual(await rejectModerationRevision(...args, { ...target.input, assessmentId: 'wrong' }), { state: 'authorized', value: 'stale' })
    let calls = 0
    const disabled = { ...verify, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: ++calls > 1 } } }
    assert.deepEqual(await rejectModerationRevision(url, 'demo-idea-map', 'synthetic-cookie', disabled, target.input), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT review_state FROM idea_revisions WHERE id=$1', [target.revision])).rows[0].review_state, 'waiting')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderation_events WHERE revision_id=$1', [target.revision])).rows[0].n, 0)
    assert.deepEqual(await rejectModerationRevision(...args, target.input), { state: 'authorized', value: 'rejected' })
    assert.deepEqual(await rejectModerationRevision(...args, target.input), { state: 'authorized', value: 'stale' })
    assert.deepEqual((await pool.query('SELECT actor_id,state,reason,assessment_id FROM moderation_events WHERE revision_id=$1', [target.revision])).rows,
      [{ actor_id: actor, state: 'rejected', reason: 'Synthetic decision', assessment_id: 'decision-first' }])
    assert.equal(await executeModerationJob(pool, target.job, async () => 'allow'), 'stale')
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [target.idea])).rows[0].publication_state, 'private')

    const current = await create('superseded-assessment')
    await recordAcceptedAssessment(pool, { id: 'replacement-assessment', revisionId: current.revision, fingerprint: 'b'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    assert.deepEqual(await rejectModerationRevision(...args, current.input), { state: 'authorized', value: 'stale' })
    const edited = await create('old-revision')
    await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}')", [edited.idea])
    assert.deepEqual(await rejectModerationRevision(...args, edited.input), { state: 'authorized', value: 'stale' })
    await assert.rejects(pool.query("INSERT INTO moderation_events(revision_id,assessment_id,state) VALUES ($1,'replacement-assessment','rejected')", [edited.revision]), { code: '23503' })

    const published = await create('old-published')
    assert.equal(await executeModerationJob(pool, published.job, async () => 'allow'), 'completed')
    const edit = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [published.idea])).rows[0].id
    assert.deepEqual(await rejectModerationRevision(...args, { revisionId: edit, assessmentId: null, reason: 'Synthetic edit rejection' }), { state: 'authorized', value: 'rejected' })
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id=$1', [published.idea])).rows[0].revision_id, published.revision)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [published.idea])).rows[0].publication_state, 'approved')

    const rollback = await create('audit-failure')
    await pool.query("CREATE FUNCTION public.synthetic_decision_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$")
    await pool.query('CREATE TRIGGER synthetic_decision_failure BEFORE INSERT ON moderation_events FOR EACH ROW EXECUTE FUNCTION public.synthetic_decision_failure()')
    try { await assert.rejects(rejectModerationRevision(...args, rollback.input), /synthetic audit failure/) }
    finally { await pool.query('DROP TRIGGER synthetic_decision_failure ON moderation_events'); await pool.query('DROP FUNCTION public.synthetic_decision_failure()') }
    assert.equal((await pool.query('SELECT review_state FROM idea_revisions WHERE id=$1', [rollback.revision])).rows[0].review_state, 'waiting')

    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.reject_moderation_revision('firebase:demo-idea-map','moderator',$1,$2,'Synthetic')", [rollback.revision, 'audit-failure']), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.reject_moderation_revision(text,text,uuid,text,text) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT * FROM moderation_events'), { code: '42501' })
      await assert.rejects(limited.query("UPDATE idea_revisions SET review_state='rejected'"), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    const restricted = new URL(url)
    restricted.searchParams.set('options', `-c role=${role}`)
    assert.deepEqual(await rejectModerationRevision(restricted.toString(), 'demo-idea-map', 'synthetic-cookie', verify, rollback.input), { state: 'authorized', value: 'rejected' })

    const racing = await create('race-reject')
    const decisionTx = await pool.connect()
    try {
      await decisionTx.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      assert.equal((await decisionTx.query("SELECT public.reject_moderation_revision('firebase:demo-idea-map','moderator',$1,$2,'Synthetic race') AS result", [racing.revision, racing.input.assessmentId])).rows[0].result, 'rejected')
      const publication = executeModerationJob(pool, racing.job, async () => 'allow')
      assert.equal(await Promise.race([publication.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await decisionTx.query('COMMIT')
      assert.equal(await publication, 'stale')
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [racing.revision])).rows[0].n, 0)
    } finally { await decisionTx.query('ROLLBACK'); decisionTx.release() }
    await pool.query("UPDATE moderator_assignments SET revoked_by=$1,revoked_at=now(),revoke_reason='synthetic revoke' WHERE id=$2", [actor, assignment])
    const revoked = await create('revoked-moderator')
    assert.deepEqual(await rejectModerationRevision(...args, revoked.input), { state: 'forbidden' })
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
