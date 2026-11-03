import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { approveModerationRevision } from '../dist/moderator-decisions.js'
import { placeModeratorHold, releaseModeratorHold } from '../dist/moderator-holds.js'
import { requestModeratorChanges, resolveModeratorChanges } from '../dist/moderator-change-requests.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('manual approval requires current moderator and revision, respects blocks, and commits publication atomically', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `manual_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const outsider = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator'),($2,'firebase:demo-idea-map','outsider')", [moderator, outsider])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic grant') RETURNING id", [moderator])).rows[0].id
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('manual@example.invalid') RETURNING id")).rows[0].id
    const verifier = uid => ({ async verifySessionCookie() { return { uid, email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'password' } } }, async getUser() { return { uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false } } })
    const args = [url, 'demo-idea-map', 'cookie', verifier('moderator')]
    const makeIdea = async () => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id,owner_id) VALUES ($1,$2) RETURNING id', [contact, outsider])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      return { idea, revision }
    }
    const first = await makeIdea()
    const input = { revisionId: first.revision, assessmentId: null, reason: 'Synthetic human review' }
    assert.deepEqual(await approveModerationRevision(url, 'demo-idea-map', 'cookie', verifier('outsider'), input), { state: 'forbidden' })
    await assert.rejects(approveModerationRevision(...args, { ...input, reason: 'bad\nreason' }), /Invalid/)
    await pool.query('INSERT INTO review_gates(revision_id,blocked) VALUES ($1,true)', [first.revision])
    assert.deepEqual(await approveModerationRevision(...args, input), { state: 'authorized', value: 'blocked' })
    await pool.query('UPDATE review_gates SET blocked=false WHERE revision_id=$1', [first.revision])
    await placeModeratorHold(...args, { ...input, reason: 'synthetic hold' })
    const hold = (await pool.query('SELECT id FROM moderator_holds WHERE revision_id=$1', [first.revision])).rows[0].id
    assert.deepEqual(await approveModerationRevision(...args, input), { state: 'authorized', value: 'blocked' })
    await releaseModeratorHold(...args, { ...input, holdId: hold, reason: 'synthetic release' })
    await requestModeratorChanges(...args, { ...input, operationKey: 'manual-approval-changes', reason: 'synthetic changes' })
    assert.deepEqual(await approveModerationRevision(...args, input), { state: 'authorized', value: 'blocked' })
    const requestId = (await pool.query('SELECT id FROM moderator_change_requests WHERE idea_id=$1', [first.idea])).rows[0].id
    await resolveModeratorChanges(...args, { ...input, requestId, reason: 'synthetic resolution' })
    let identityChecks = 0
    const changedIdentity = { ...verifier('moderator'), async getUser() { return { uid: 'moderator', email: 'moderator@example.invalid', emailVerified: true, disabled: ++identityChecks > 1 } } }
    assert.deepEqual(await approveModerationRevision(url, 'demo-idea-map', 'cookie', changedIdentity, input), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approved_revisions WHERE idea_id=$1', [first.idea])).rows[0].n, 0)
    assert.deepEqual(await approveModerationRevision(...args, input), { state: 'authorized', value: 'approved' })
    assert.deepEqual(await approveModerationRevision(...args, input), { state: 'authorized', value: 'stale' })
    assert.deepEqual((await pool.query('SELECT i.publication_state,r.review_state,p.revision_id,a.verified_for_trust FROM ideas i JOIN approved_revisions p ON p.idea_id=i.id JOIN idea_revisions r ON r.id=p.revision_id JOIN approval_records a ON a.idea_id=i.id WHERE i.id=$1', [first.idea])).rows[0], { publication_state: 'approved', review_state: 'approved', revision_id: first.revision, verified_for_trust: true })
    assert.deepEqual((await pool.query("SELECT actor_id,assessment_id,state,reason FROM moderation_events WHERE revision_id=$1 AND state='approved'", [first.revision])).rows[0], { actor_id: moderator, assessment_id: null, state: 'approved', reason: 'Synthetic human review' })
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs j JOIN outbox o ON o.job_id=j.id WHERE j.kind='projection' AND j.revision_id=$1", [first.revision])).rows[0].n, 1)
    const next = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [first.idea])).rows[0].id
    const newest = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,3,'{}') RETURNING id", [first.idea])).rows[0].id
    assert.deepEqual(await approveModerationRevision(...args, { ...input, revisionId: next }), { state: 'authorized', value: 'stale' })
    assert.equal((await pool.query('SELECT revision_id FROM approved_revisions WHERE idea_id=$1', [first.idea])).rows[0].revision_id, first.revision)
    await pool.query("INSERT INTO revision_assessments(id,revision_id,fingerprint,received_at,current) VALUES ('synthetic-assessment',$1,$2,clock_timestamp(),true)", [newest, 'a'.repeat(64)])
    assert.deepEqual(await approveModerationRevision(...args, { ...input, revisionId: newest }), { state: 'authorized', value: 'stale' })
    assert.deepEqual(await approveModerationRevision(...args, { ...input, revisionId: newest, assessmentId: 'synthetic-assessment' }), { state: 'authorized', value: 'approved' })
    assert.equal((await pool.query('SELECT revision_id FROM approval_records WHERE idea_id=$1', [first.idea])).rows[0].revision_id, newest)
    const collision = await makeIdea()
    await pool.query("INSERT INTO jobs(kind,idempotency_key,revision_id,scheduled_at) VALUES ('projection',$1,$2,clock_timestamp())", [`manual-approval:${collision.revision}`, collision.revision])
    await assert.rejects(approveModerationRevision(...args, { ...input, revisionId: collision.revision }), /conflicts with existing intent/)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [collision.idea])).rows[0].publication_state, 'private')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderation_events WHERE revision_id=$1', [collision.revision])).rows[0].n, 0)
    const rollback = await makeIdea()
    await pool.query("CREATE FUNCTION public.synthetic_reject_approval_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason='synthetic rollback' THEN RAISE EXCEPTION 'synthetic event failure'; END IF; RETURN NEW; END $$")
    await pool.query('CREATE TRIGGER synthetic_reject_approval_event BEFORE INSERT ON moderation_events FOR EACH ROW EXECUTE FUNCTION public.synthetic_reject_approval_event()')
    try {
      await assert.rejects(approveModerationRevision(...args, { ...input, revisionId: rollback.revision, reason: 'synthetic rollback' }), /synthetic event failure/)
      assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [rollback.idea])).rows[0].publication_state, 'private')
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM approved_revisions WHERE idea_id=$1', [rollback.idea])).rows[0].n, 0)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_records WHERE idea_id=$1', [rollback.idea])).rows[0].n, 0)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM jobs WHERE revision_id=$1', [rollback.revision])).rows[0].n, 0)
    } finally {
      await pool.query('DROP TRIGGER synthetic_reject_approval_event ON moderation_events')
      await pool.query('DROP FUNCTION public.synthetic_reject_approval_event()')
    }
    const heldEdit = await makeIdea()
    await placeModeratorHold(...args, { ...input, revisionId: heldEdit.revision, reason: 'synthetic earlier hold' })
    const heldNewRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [heldEdit.idea])).rows[0].id
    assert.deepEqual(await approveModerationRevision(...args, { ...input, revisionId: heldNewRevision }), { state: 'authorized', value: 'blocked' })
    const raced = await makeIdea()
    const holdTx = await pool.connect()
    try {
      await holdTx.query('BEGIN')
      await holdTx.query("INSERT INTO moderator_holds(revision_id,placed_by,reason) VALUES ($1,$2,'racing hold')", [raced.revision, moderator])
      const approval = approveModerationRevision(...args, { ...input, revisionId: raced.revision })
      assert.equal(await Promise.race([approval.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await holdTx.query('COMMIT')
      assert.deepEqual(await approval, { state: 'authorized', value: 'blocked' })
    } finally { await holdTx.query('ROLLBACK'); holdTx.release() }
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.approve_moderation_revision('firebase:demo-idea-map','moderator',$1,NULL,'synthetic')", [raced.revision]), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM moderation_events'), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.approve_moderation_revision(text,text,uuid,text,text) TO "${role}"`)
    const restrictedUrl = new URL(url)
    restrictedUrl.searchParams.set('options', `-c role=${role}`)
    const restricted = await makeIdea()
    assert.deepEqual(await approveModerationRevision(restrictedUrl.toString(), 'demo-idea-map', 'cookie', verifier('moderator'), { ...input, revisionId: restricted.revision }), { state: 'authorized', value: 'approved' })
    await pool.query("UPDATE moderator_assignments SET revoked_by=$1,revoked_at=clock_timestamp(),revoke_reason='synthetic revocation' WHERE id=$2", [moderator, assignment])
    assert.deepEqual(await approveModerationRevision(...args, { ...input, revisionId: raced.revision }), { state: 'forbidden' })
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
