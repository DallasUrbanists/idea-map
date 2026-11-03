import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { requestModeratorChanges, resolveModeratorChanges } from '../dist/moderator-change-requests.js'
import { placeModeratorHold, releaseModeratorHold } from '../dist/moderator-holds.js'
import { rejectModerationRevision } from '../dist/moderator-decisions.js'
import { executeModerationJob, recordAcceptedAssessment } from '../dist/moderation-jobs.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('change requests survive edits and remain separate from holds and legal retention', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `changes_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator')", [moderator])
    await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic grant')", [moderator])
    const session = { uid: 'moderator', email: 'moderator@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verify = { async verifySessionCookie() { return session }, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: false } } }
    const other = { ...verify, async verifySessionCookie() { return { ...session, uid: 'other' } }, async getUser() { return { uid: 'other', email: session.email, emailVerified: true, disabled: false } } }
    const args = [url, 'demo-idea-map', 'synthetic-cookie', verify]
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('changes@example.invalid') RETURNING id")).rows[0].id
    const create = async id => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      const result = await recordAcceptedAssessment(pool, { id, revisionId: revision, fingerprint: 'a'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
      return { idea, revision, job: result.jobIds[0], input: { operationKey: id, revisionId: revision, assessmentId: id, reason: 'Synthetic changes requested' } }
    }
    const item = await create('changes-before-edit')
    assert.deepEqual(await requestModeratorChanges(url, 'demo-idea-map', 'synthetic-cookie', other, item.input), { state: 'forbidden' })
    assert.deepEqual(await requestModeratorChanges(...args, { ...item.input, operationKey: 'stale-key', assessmentId: 'stale' }), { state: 'authorized', value: 'stale' })
    let lookups = 0
    const disabled = { ...verify, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: ++lookups > 1 } } }
    assert.deepEqual(await requestModeratorChanges(url, 'demo-idea-map', 'synthetic-cookie', disabled, item.input), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_requests WHERE idea_id=$1', [item.idea])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_operations WHERE operation_key=$1', [item.input.operationKey])).rows[0].n, 0)
    assert.deepEqual(await requestModeratorChanges(...args, item.input), { state: 'authorized', value: 'requested' })
    assert.deepEqual(await requestModeratorChanges(...args, item.input), { state: 'authorized', value: 'requested' })
    const request = (await pool.query('SELECT * FROM moderator_change_requests WHERE idea_id=$1', [item.idea])).rows[0]
    assert.equal(request.requested_by, moderator)
    assert.equal(request.requested_assessment_id, item.input.assessmentId)
    await assert.rejects(executeModerationJob(pool, item.job, async () => 'allow'), /changes are requested/)

    const edited = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [item.idea])).rows[0].id
    const assessed = await recordAcceptedAssessment(pool, { id: 'changes-after-edit', revisionId: edited, fingerprint: 'b'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    await assert.rejects(executeModerationJob(pool, assessed.jobIds[0], async () => 'allow'), /changes are requested/)
    assert.deepEqual(await requestModeratorChanges(...args, { ...item.input, operationKey: 'edited-key', revisionId: edited, assessmentId: 'changes-after-edit' }), { state: 'authorized', value: 'already-requested' })
    assert.deepEqual(await resolveModeratorChanges(...args, { ...item.input, requestId: request.id }), { state: 'authorized', value: 'stale' })
    const current = { revisionId: edited, assessmentId: 'changes-after-edit', reason: 'Synthetic review completed' }
    const elsewhere = await create('other-idea')
    assert.deepEqual(await resolveModeratorChanges(...args, { ...elsewhere.input, requestId: request.id }), { state: 'authorized', value: 'not-requested' })
    assert.deepEqual(await placeModeratorHold(...args, { ...current, operationKey: 'changes-hold' }), { state: 'authorized', value: 'placed' })
    const hold = (await pool.query('SELECT id FROM moderator_holds WHERE revision_id=$1', [edited])).rows[0].id
    assert.deepEqual(await resolveModeratorChanges(...args, { ...current, requestId: request.id }), { state: 'authorized', value: 'resolved' })
    assert.deepEqual(await resolveModeratorChanges(...args, { ...current, requestId: request.id }), { state: 'authorized', value: 'not-requested' })
    const resolved = (await pool.query('SELECT resolved_by,resolved_revision_id,resolved_assessment_id,resolution_reason FROM moderator_change_requests WHERE id=$1', [request.id])).rows[0]
    assert.deepEqual(resolved, { resolved_by: moderator, resolved_revision_id: edited, resolved_assessment_id: 'changes-after-edit', resolution_reason: 'Synthetic review completed' })
    await assert.rejects(executeModerationJob(pool, assessed.jobIds[0], async () => 'allow'), /on hold/)
    assert.deepEqual(await releaseModeratorHold(...args, { ...current, holdId: hold }), { state: 'authorized', value: 'released' })
    assert.equal(await executeModerationJob(pool, assessed.jobIds[0], async () => 'allow'), 'completed')
    await assert.rejects(pool.query("UPDATE moderator_change_requests SET reason='changed' WHERE id=$1", [request.id]), /Only resolution/)

    // A response-lost retry after resolution must never recreate the block.
    const retry = await create('durable-retry')
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => requestModeratorChanges(...args, retry.input)))
    assert.ok(concurrent.every(result => result.value === 'requested'))
    const retryRequest = (await pool.query('SELECT id FROM moderator_change_requests WHERE idea_id=$1', [retry.idea])).rows[0].id
    await resolveModeratorChanges(...args, { ...retry.input, requestId: retryRequest })
    assert.equal((await requestModeratorChanges(...args, retry.input)).value, 'requested')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_requests WHERE idea_id=$1 AND resolved_at IS NULL', [retry.idea])).rows[0].n, 0)
    assert.equal((await requestModeratorChanges(...args, { ...retry.input, reason: 'Different decision' })).value, 'idempotency-conflict')
    assert.equal((await requestModeratorChanges(...args, { ...retry.input, revisionId: retry.revision.toUpperCase(), reason: `  ${retry.input.reason}  ` })).value, 'requested')
    // Removing retained request metadata does not remove its durable receipt.
    await pool.query('DELETE FROM moderator_change_requests WHERE id=$1', [retryRequest])
    assert.equal((await requestModeratorChanges(...args, retry.input)).value, 'requested')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_requests WHERE idea_id=$1', [retry.idea])).rows[0].n, 0)
    assert.equal((await requestModeratorChanges(...args, { ...retry.input, operationKey: 'new-decision' })).value, 'requested')
    const secondModerator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','other')", [secondModerator])
    await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic grant')", [secondModerator])
    assert.equal((await requestModeratorChanges(url, 'demo-idea-map', 'synthetic-cookie', other, { ...elsewhere.input, operationKey: retry.input.operationKey })).value, 'requested')
    // The provider recheck rollback also removes the receipt, allowing recovery.
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_operations WHERE operation_key=$1', [item.input.operationKey])).rows[0].n, 1)

    const rejected = await create('changes-then-rejected')
    assert.deepEqual(await requestModeratorChanges(...args, rejected.input), { state: 'authorized', value: 'requested' })
    const rejectedRequest = (await pool.query('SELECT id FROM moderator_change_requests WHERE idea_id=$1', [rejected.idea])).rows[0].id
    assert.deepEqual(await rejectModerationRevision(...args, rejected.input), { state: 'authorized', value: 'rejected' })
    assert.deepEqual(await resolveModeratorChanges(...args, { ...rejected.input, requestId: rejectedRequest }), { state: 'authorized', value: 'resolved' })
    assert.equal(await executeModerationJob(pool, rejected.job, async () => 'allow'), 'stale')

    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.apply_moderator_change_request('firebase:demo-idea-map','moderator','request',$1,$2,NULL,'Synthetic')", [elsewhere.revision, elsewhere.input.assessmentId]), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.request_moderator_changes_once(text,text,uuid,text,text,text), public.lock_active_moderator(text,text), public.apply_moderator_change_request(text,text,text,uuid,text,uuid,text) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT * FROM moderator_change_requests'), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM moderator_change_operations'), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM public.prune_resolved_change_requests($1)', [item.idea]), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    const restricted = new URL(url)
    restricted.searchParams.set('options', `-c role=${role}`)
    assert.deepEqual(await requestModeratorChanges(restricted.toString(), 'demo-idea-map', 'synthetic-cookie', verify, elsewhere.input), { state: 'authorized', value: 'already-requested' })

    const race = await create('change-race')
    const tx = await pool.connect()
    try {
      await tx.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      assert.equal((await tx.query("SELECT public.apply_moderator_change_request('firebase:demo-idea-map','moderator','request',$1,$2,NULL,'Synthetic race') AS result", [race.revision, race.input.assessmentId])).rows[0].result, 'requested')
      const publication = executeModerationJob(pool, race.job, async () => 'allow')
      assert.equal(await Promise.race([publication.then(() => 'finished', () => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await tx.query('COMMIT')
      await assert.rejects(publication, /changes are requested/)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [race.revision])).rows[0].n, 0)
    } finally { await tx.query('ROLLBACK'); tx.release() }

    // Insert a historical synthetic resolution without changing the database clock.
    await pool.query(`INSERT INTO moderator_change_requests(idea_id,requested_revision_id,requested_by,reason,resolved_revision_id,resolved_by,resolved_at,resolution_reason)
      VALUES ($1,$2,$3,'old synthetic request',$2,$3,clock_timestamp()-interval '91 days','old synthetic resolution')`, [race.idea, race.revision, moderator])
    const director = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','director')", [director])
    await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic authority',$1)", [director])
    const legalHold = (await pool.query("SELECT public.place_legal_hold('firebase:demo-idea-map','director',$1,'synthetic-case','Synthetic hold') AS id", [race.idea])).rows[0].id
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_resolved_change_requests($1)', [race.idea])).rows[0], { blocked: true, requests_deleted: 0 })
    await pool.query("SELECT public.release_legal_hold('firebase:demo-idea-map','director',$1,'Synthetic release',NULL)", [legalHold])
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_resolved_change_requests($1)', [race.idea])).rows[0], { blocked: false, requests_deleted: 1 })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_requests WHERE idea_id=$1 AND resolved_at IS NULL', [race.idea])).rows[0].n, 1)
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
