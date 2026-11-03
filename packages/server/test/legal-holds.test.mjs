import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { lockIdeaIfNotHeld, placeLegalHold, releaseLegalHold } from '../dist/legal-holds.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('separate authorized legal holds serialize with retention and preserve overlapping cases', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `legal_test_${randomBytes(8).toString('hex')}`
  const retentionRole = `retention_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  let retentionRoleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const director = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const delegate = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','director'),($2,'firebase:demo-idea-map','moderator'),($3,'firebase:demo-idea-map','delegate')", [director, moderator, delegate])
    await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$2,'synthetic moderator')", [moderator, director])
    const assignment = (await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic authority',$1) RETURNING id", [director])).rows[0].id
    await assert.rejects(pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'delegate','synthetic document',$2)", [delegate, moderator]), /active Executive Director/)
    await assert.rejects(pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic authority',$1)", [moderator]), { code: '23505' })
    const delegation = (await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'delegate','synthetic written delegation',$2) RETURNING id", [delegate, director])).rows[0].id
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('legal@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content,review_state) VALUES ($1,1,'{}','approved') RETURNING id", [idea])).rows[0].id
    await pool.query('INSERT INTO approval_records(idea_id,revision_id,verified_for_trust) VALUES ($1,$2,true)', [idea, revision])
    await pool.query("INSERT INTO moderation_events(revision_id,actor_id,state,reason,created_at) VALUES ($1,$2,'approved','old',clock_timestamp()-interval '91 days'),($1,$2,'rejected','recent',clock_timestamp()-interval '89 days'),($1,$2,'reviewing','not a decision',clock_timestamp()-interval '91 days')", [revision, moderator])
    await pool.query("INSERT INTO approval_corrections(idea_id,actor_id,excluded,reason,created_at) VALUES ($1,$2,true,'old',clock_timestamp()-interval '91 days'),($1,$2,false,'recent',clock_timestamp()-interval '89 days')", [idea, moderator])
    const session = uid => ({ uid, email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'password' } })
    const verifier = uid => ({ async verifySessionCookie() { return session(uid) }, async getUser() { return { uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false } } })
    const directorVerifier = verifier('director')
    const input = { ideaId: idea, caseReference: 'synthetic-case-one', reason: 'Synthetic preservation' }
    const args = [url, 'demo-idea-map', 'synthetic-cookie', directorVerifier]
    assert.deepEqual(await placeLegalHold(url, 'demo-idea-map', 'synthetic-cookie', verifier('moderator'), input), { state: 'forbidden' })
    assert.deepEqual(await placeLegalHold(url, 'other-project', 'synthetic-cookie', directorVerifier, input), { state: 'forbidden' })
    let calls = 0
    const disabled = { ...directorVerifier, async getUser() { return { uid: 'director', email: 'director@example.invalid', emailVerified: true, disabled: ++calls > 1 } } }
    assert.deepEqual(await placeLegalHold(url, 'demo-idea-map', 'synthetic-cookie', disabled, input), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM legal_holds')).rows[0].n, 0)
    const missingId = '00000000-0000-0000-0000-000000000001'
    const missingRelease = { holdId: missingId, reason: 'Synthetic release', legalReviewReference: null }
    assert.deepEqual(await placeLegalHold(...args, { ...input, ideaId: missingId }), { state: 'not_found' })
    assert.deepEqual(await releaseLegalHold(...args, missingRelease), { state: 'not_found' })
    assert.deepEqual(await placeLegalHold(url, 'demo-idea-map', 'synthetic-cookie', verifier('moderator'), { ...input, ideaId: missingId }), { state: 'forbidden' })
    assert.deepEqual(await releaseLegalHold(url, 'demo-idea-map', 'synthetic-cookie', verifier('moderator'), missingRelease), { state: 'forbidden' })
    assert.deepEqual(await placeLegalHold(...args, input), { state: 'processed' })
    const originalHold = (await pool.query('SELECT * FROM legal_holds')).rows[0]
    assert.deepEqual(await placeLegalHold(...args, { ...input, reason: 'Retry must preserve reason' }), { state: 'already_held' })
    assert.deepEqual((await pool.query('SELECT * FROM legal_holds')).rows[0], originalHold)
    assert.deepEqual(await placeLegalHold(...args, { ...input, caseReference: 'synthetic-case-two' }), { state: 'processed' })
    const holds = (await pool.query('SELECT id,case_reference,placed_by,placement_authority_id FROM legal_holds ORDER BY case_reference')).rows
    assert.equal(holds.length, 2)
    assert.equal(holds[0].placed_by, director)
    assert.equal(holds[0].placement_authority_id, assignment)
    await assert.rejects(pool.query("UPDATE legal_hold_assignments SET authorization_reference='changed' WHERE id=$1", [assignment]), /Only revocation/)
    await assert.rejects(pool.query('DELETE FROM legal_hold_assignments WHERE id=$1', [assignment]), /cannot be deleted/)
    await assert.rejects(pool.query("UPDATE legal_holds SET reason='changed' WHERE id=$1", [holds[0].id]), /Only release/)
    await assert.rejects(pool.query('DELETE FROM legal_holds WHERE id=$1', [holds[0].id]), /cannot be deleted/)
    const check = async () => {
      const client = await pool.connect()
      try { await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); const allowed = await lockIdeaIfNotHeld(client, idea); await client.query('COMMIT'); return allowed }
      finally { client.release() }
    }
    assert.equal(await check(), false)
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_idea_decision_metadata($1)', [idea])).rows[0], { blocked: true, moderation_events_deleted: 0, correction_events_deleted: 0 })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_corrections WHERE idea_id=$1', [idea])).rows[0].n, 2)
    assert.deepEqual(await releaseLegalHold(...args, { holdId: holds[0].id, reason: 'Synthetic release', legalReviewReference: 'synthetic-review' }), { state: 'processed' })
    const originalRelease = (await pool.query('SELECT * FROM legal_holds WHERE id=$1', [holds[0].id])).rows[0]
    assert.deepEqual(await releaseLegalHold(...args, { holdId: holds[0].id, reason: 'Retry must preserve release', legalReviewReference: null }), { state: 'already_released' })
    assert.deepEqual((await pool.query('SELECT * FROM legal_holds WHERE id=$1', [holds[0].id])).rows[0], originalRelease)
    assert.equal(await check(), false)
    const release = (await pool.query('SELECT released_by,release_authority_id,release_reason,legal_review_reference FROM legal_holds WHERE id=$1', [holds[0].id])).rows[0]
    assert.deepEqual(release, { released_by: director, release_authority_id: assignment, release_reason: 'Synthetic release', legal_review_reference: 'synthetic-review' })
    assert.deepEqual(await releaseLegalHold(...args, { holdId: holds[1].id, reason: 'Synthetic release', legalReviewReference: null }), { state: 'processed' })
    assert.equal(await check(), true)
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_idea_decision_metadata($1)', [idea])).rows[0], { blocked: false, moderation_events_deleted: 1, correction_events_deleted: 1 })
    assert.deepEqual((await pool.query('SELECT state FROM moderation_events WHERE revision_id=$1 ORDER BY state', [revision])).rows.map(row => row.state).sort(), ['rejected', 'reviewing'])
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_corrections WHERE idea_id=$1', [idea])).rows[0].n, 1)
    assert.deepEqual((await pool.query('SELECT verified_for_trust,excluded_for_violation FROM approval_records WHERE idea_id=$1', [idea])).rows[0], { verified_for_trust: true, excluded_for_violation: false })
    assert.deepEqual(await placeLegalHold(url, 'demo-idea-map', 'synthetic-cookie', verifier('delegate'), { ...input, caseReference: 'delegate-case' }), { state: 'processed' })
    const delegatedHold = (await pool.query("SELECT id,placed_by,placement_authority_id FROM legal_holds WHERE case_reference='delegate-case'")).rows[0]
    assert.equal(delegatedHold.placed_by, delegate)
    assert.equal(delegatedHold.placement_authority_id, delegation)
    assert.deepEqual(await releaseLegalHold(url, 'demo-idea-map', 'synthetic-cookie', verifier('delegate'), { holdId: delegatedHold.id, reason: 'Synthetic release', legalReviewReference: null }), { state: 'processed' })
    const repeatable = await pool.connect()
    try {
      await repeatable.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      assert.equal(await lockIdeaIfNotHeld(repeatable, idea), false)
      assert.deepEqual((await repeatable.query('SELECT * FROM public.prune_idea_decision_metadata($1)', [idea])).rows[0], { blocked: true, moderation_events_deleted: 0, correction_events_deleted: 0 })
      await repeatable.query('ROLLBACK')
    }
    finally { repeatable.release() }

    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.lock_active_legal_hold_authority('firebase:demo-idea-map','director')"), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM public.prune_idea_decision_metadata($1)', [idea]), { code: '42501' })
      await assert.rejects(limited.query("SELECT public.place_legal_hold_outcome('firebase:demo-idea-map','director',$1,'case','reason')", [idea]), { code: '42501' })
      await assert.rejects(limited.query("SELECT public.release_legal_hold_outcome('firebase:demo-idea-map','director',$1,'reason',NULL)", [holds[0].id]), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_legal_hold_authority(text,text), public.place_legal_hold_outcome(text,text,uuid,text,text), public.release_legal_hold_outcome(text,text,uuid,text,text) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      assert.equal((await limited.query("SELECT public.lock_active_legal_hold_authority('firebase:demo-idea-map','director') AS id")).rows[0].id, director)
      await assert.rejects(limited.query('SELECT * FROM public.prune_idea_decision_metadata($1)', [idea]), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM legal_holds'), { code: '42501' })
      await assert.rejects(limited.query('UPDATE legal_hold_assignments SET revoked_at=now()'), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    await pool.query(`CREATE ROLE "${retentionRole}" NOLOGIN`)
    retentionRoleCreated = true
    await pool.query(`GRANT EXECUTE ON FUNCTION public.prune_idea_decision_metadata(uuid) TO "${retentionRole}"`)
    const limitedRetention = await pool.connect()
    try {
      await limitedRetention.query(`SET ROLE "${retentionRole}"`)
      assert.deepEqual((await limitedRetention.query('SELECT * FROM public.prune_idea_decision_metadata($1)', [idea])).rows[0], { blocked: false, moderation_events_deleted: 0, correction_events_deleted: 0 })
      await assert.rejects(limitedRetention.query("SELECT public.lock_active_legal_hold_authority('firebase:demo-idea-map','director')"), { code: '42501' })
      await assert.rejects(limitedRetention.query('SELECT * FROM legal_holds'), { code: '42501' })
    } finally { await limitedRetention.query('RESET ROLE'); limitedRetention.release() }
    const restrictedUrl = new URL(url)
    restrictedUrl.searchParams.set('options', `-c role=${role}`)
    assert.deepEqual(await placeLegalHold(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', directorVerifier,
      { ...input, caseReference: 'restricted-runtime' }), { state: 'processed' })
    const restrictedHold = (await pool.query("SELECT id FROM legal_holds WHERE case_reference='restricted-runtime'")).rows[0].id
    assert.deepEqual(await releaseLegalHold(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', directorVerifier,
      { holdId: restrictedHold, reason: 'Synthetic release', legalReviewReference: null }), { state: 'processed' })

    const restrictedArgs = [restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', directorVerifier]
    assert.deepEqual(await placeLegalHold(...restrictedArgs, { ...input, ideaId: missingId }), { state: 'not_found' })
    assert.deepEqual(await releaseLegalHold(...restrictedArgs, missingRelease), { state: 'not_found' })
    assert.deepEqual(await placeLegalHold(...restrictedArgs, { ...input, caseReference: 'synthetic-case-two' }), { state: 'processed' })
    assert.deepEqual(await placeLegalHold(...restrictedArgs, { ...input, caseReference: 'synthetic-case-two' }), { state: 'already_held' })
    assert.deepEqual(await releaseLegalHold(...restrictedArgs, { holdId: restrictedHold, reason: 'Retry', legalReviewReference: null }), { state: 'already_released' })
    calls = 0
    assert.deepEqual(await placeLegalHold(url, 'demo-idea-map', 'synthetic-cookie', disabled, { ...input, ideaId: missingId }), { state: 'unauthenticated' })
    calls = 0
    assert.deepEqual(await releaseLegalHold(url, 'demo-idea-map', 'synthetic-cookie', disabled, { holdId: restrictedHold, reason: 'Retry', legalReviewReference: null }), { state: 'unauthenticated' })

    const concurrentInput = { ...input, caseReference: 'concurrent-retry' }
    const placements = await Promise.all([placeLegalHold(...restrictedArgs, concurrentInput), placeLegalHold(...restrictedArgs, concurrentInput)])
    assert.deepEqual(placements.map(result => result.state).sort(), ['already_held', 'processed'])
    const concurrentHold = (await pool.query("SELECT id FROM legal_holds WHERE case_reference='concurrent-retry'")).rows[0].id
    const concurrentRelease = { holdId: concurrentHold, reason: 'Concurrent release', legalReviewReference: null }
    const releases = await Promise.all([releaseLegalHold(...restrictedArgs, concurrentRelease), releaseLegalHold(...restrictedArgs, concurrentRelease)])
    assert.deepEqual(releases.map(result => result.state).sort(), ['already_released', 'processed'])

    const raceIdea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const raceRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [raceIdea])).rows[0].id
    await pool.query("INSERT INTO moderation_events(revision_id,actor_id,state,reason,created_at) VALUES ($1,$2,'approved','old',clock_timestamp()-interval '91 days')", [raceRevision, moderator])
    const holdTx = await pool.connect()
    const retention = await pool.connect()
    try {
      await holdTx.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await holdTx.query("SELECT public.place_legal_hold('firebase:demo-idea-map','director',$1,'race-case','Synthetic hold')", [raceIdea])
      await retention.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      const guarded = retention.query('SELECT * FROM public.prune_idea_decision_metadata($1)', [raceIdea])
      assert.equal(await Promise.race([guarded.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await holdTx.query('COMMIT')
      assert.deepEqual((await guarded).rows[0], { blocked: true, moderation_events_deleted: 0, correction_events_deleted: 0 })
      assert.equal((await retention.query('SELECT count(*)::int AS n FROM moderation_events WHERE revision_id=$1', [raceRevision])).rows[0].n, 1)
      await retention.query('ROLLBACK')
    } finally { await holdTx.query('ROLLBACK'); await retention.query('ROLLBACK'); holdTx.release(); retention.release() }
    const directIdea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const deletionGuard = await pool.connect()
    try {
      await deletionGuard.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      assert.equal(await lockIdeaIfNotHeld(deletionGuard, directIdea), true)
      const insert = pool.query("INSERT INTO legal_holds(idea_id,case_reference,reason,placed_by,placement_authority_id) VALUES ($1,'direct-case','Synthetic hold',$2,$3)", [directIdea, director, assignment])
      assert.equal(await Promise.race([insert.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await deletionGuard.query('COMMIT')
      await insert
    } finally { await deletionGuard.query('ROLLBACK'); deletionGuard.release() }
    const active = await pool.connect()
    try {
      await active.query('BEGIN')
      await active.query("SELECT public.lock_active_legal_hold_authority('firebase:demo-idea-map','director')")
      const revoke = pool.query("UPDATE legal_hold_assignments SET revoked_by=$2,revoked_at=now(),revoke_reason='synthetic revocation' WHERE id=$1", [assignment, moderator])
      assert.equal(await Promise.race([revoke.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await active.query('COMMIT')
      await revoke
    } finally { await active.query('ROLLBACK'); active.release() }
    assert.deepEqual(await placeLegalHold(...args, { ...input, caseReference: 'after-revoke' }), { state: 'forbidden' })
  } finally {
    if (retentionRoleCreated) { await pool.query(`DROP OWNED BY "${retentionRole}"`); await pool.query(`DROP ROLE "${retentionRole}"`) }
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
