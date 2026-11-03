import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { escalateModerationRevision } from '../dist/moderator-escalations.js'
import { transferModeratorEscalation } from '../dist/moderator-escalation-transfers.js'
import { releaseModeratorHold } from '../dist/moderator-holds.js'
import { recordAcceptedAssessment, executeModerationJob } from '../dist/moderation-jobs.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('escalation owner transfers retain the block, history, and legal-hold retention', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `transfer_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const actor = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const first = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const second = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const outsider = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator')", [actor])
    await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic actor'),($2,$1,'first owner'),($3,$1,'second owner')", [actor, first, second])
    const session = { uid: 'moderator', email: 'moderator@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verify = { async verifySessionCookie() { return session }, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: false } } }
    const other = { ...verify, async verifySessionCookie() { return { ...session, uid: 'other' } }, async getUser() { return { uid: 'other', email: session.email, emailVerified: true, disabled: false } } }
    const args = [url, 'demo-idea-map', 'synthetic-cookie', verify]
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('transfer@example.invalid') RETURNING id")).rows[0].id
    const create = async id => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      const assessment = await recordAcceptedAssessment(pool, { id, revisionId: revision, fingerprint: 'a'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
      return { idea, revision, job: assessment.jobIds[0], input: { revisionId: revision, assessmentId: id, ownerId: first, reason: 'Synthetic escalation' } }
    }
    const item = await create('transfer-first')
    assert.deepEqual(await escalateModerationRevision(...args, item.input), { state: 'authorized', value: 'escalated' })
    const hold = (await pool.query("SELECT id FROM moderator_holds WHERE revision_id=$1 AND kind='escalation'", [item.revision])).rows[0].id
    const transfer = { ...item.input, holdId: hold, expectedSequence: 0, ownerId: second, reason: 'Synthetic handoff' }
    assert.deepEqual(await transferModeratorEscalation(url, 'demo-idea-map', 'synthetic-cookie', other, transfer), { state: 'forbidden' })
    assert.deepEqual(await transferModeratorEscalation(...args, { ...transfer, ownerId: outsider }), { state: 'authorized', value: 'owner-unavailable' })
    assert.deepEqual(await transferModeratorEscalation(...args, { ...transfer, assessmentId: 'stale' }), { state: 'authorized', value: 'stale' })
    let calls = 0
    const disabled = { ...verify, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: ++calls > 1 } } }
    assert.deepEqual(await transferModeratorEscalation(url, 'demo-idea-map', 'synthetic-cookie', disabled, transfer), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_escalation_transfers WHERE hold_id=$1', [hold])).rows[0].n, 0)
    assert.deepEqual(await transferModeratorEscalation(...args, transfer), { state: 'authorized', value: 'transferred' })
    assert.deepEqual(await transferModeratorEscalation(...args, transfer), { state: 'authorized', value: 'stale' })
    assert.deepEqual(await transferModeratorEscalation(...args, { ...transfer, expectedSequence: 1 }), { state: 'authorized', value: 'unchanged' })
    const firstTransfer = (await pool.query('SELECT sequence,previous_owner_id,owner_id,actor_id,revision_id,assessment_id FROM moderator_escalation_transfers WHERE hold_id=$1', [hold])).rows[0]
    assert.deepEqual(firstTransfer, { sequence: 1, previous_owner_id: first, owner_id: second, actor_id: actor, revision_id: item.revision, assessment_id: item.input.assessmentId })
    await assert.rejects(executeModerationJob(pool, item.job, async () => 'allow'), /on hold/)
    await assert.rejects(pool.query("UPDATE moderator_escalation_transfers SET reason='changed' WHERE hold_id=$1", [hold]), /cannot be updated/)
    await pool.query("UPDATE moderator_assignments SET revoked_by=$1,revoked_at=now(),revoke_reason='synthetic revoke' WHERE user_id=$2", [actor, second])
    assert.deepEqual(await transferModeratorEscalation(...args, { ...transfer, expectedSequence: 1, ownerId: actor }), { state: 'authorized', value: 'transferred' })
    assert.deepEqual(await transferModeratorEscalation(...args, transfer), { state: 'authorized', value: 'owner-unavailable' })
    assert.deepEqual(await transferModeratorEscalation(...args, { ...transfer, ownerId: first }), { state: 'authorized', value: 'stale' })
    const events = (await pool.query('SELECT sequence,previous_owner_id,owner_id FROM moderator_escalation_transfers WHERE hold_id=$1 ORDER BY sequence', [hold])).rows
    assert.deepEqual(events, [{ sequence: 1, previous_owner_id: first, owner_id: second }, { sequence: 2, previous_owner_id: second, owner_id: actor }])
    await assert.rejects(executeModerationJob(pool, item.job, async () => 'allow'), /on hold/)

    const edited = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [item.idea])).rows[0].id
    const newAssessment = await recordAcceptedAssessment(pool, { id: 'transfer-after-edit', revisionId: edited, fingerprint: 'b'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    assert.deepEqual(await transferModeratorEscalation(...args, { ...transfer, expectedSequence: 2, ownerId: first }), { state: 'authorized', value: 'stale' })
    const current = { ...transfer, revisionId: edited, assessmentId: 'transfer-after-edit', expectedSequence: 2, ownerId: first }
    assert.deepEqual(await transferModeratorEscalation(...args, current), { state: 'authorized', value: 'transferred' })
    await assert.rejects(executeModerationJob(pool, newAssessment.jobIds[0], async () => 'allow'), /on hold/)
    const elsewhere = await create('transfer-other')
    assert.deepEqual(await transferModeratorEscalation(...args, { ...current, revisionId: elsewhere.revision, assessmentId: elsewhere.input.assessmentId }), { state: 'authorized', value: 'not-active' })

    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.transfer_moderator_escalation('firebase:demo-idea-map','moderator',$1,$2,$3,3,$4,'Synthetic')", [hold, edited, current.assessmentId, actor]), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text),public.transfer_moderator_escalation(text,text,uuid,uuid,text,integer,uuid,text) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT * FROM moderator_escalation_transfers'), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM public.prune_released_moderator_holds($1)', [item.idea]), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    const restricted = new URL(url)
    restricted.searchParams.set('options', `-c role=${role}`)
    assert.deepEqual(await transferModeratorEscalation(restricted.toString(), 'demo-idea-map', 'synthetic-cookie', verify, { ...current, expectedSequence: 3, ownerId: actor }), { state: 'authorized', value: 'transferred' })

    const tx = await pool.connect()
    try {
      await tx.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      assert.equal((await tx.query("SELECT public.transfer_moderator_escalation('firebase:demo-idea-map','moderator',$1,$2,$3,4,$4,'Synthetic race') AS result", [hold, edited, current.assessmentId, first])).rows[0].result, 'transferred')
      const publication = executeModerationJob(pool, newAssessment.jobIds[0], async () => 'allow')
      assert.equal(await Promise.race([publication.then(() => 'finished', () => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await tx.query('COMMIT')
      await assert.rejects(publication, /on hold/)
    } finally { await tx.query('ROLLBACK'); tx.release() }
    assert.deepEqual(await releaseModeratorHold(...args, { revisionId: edited, assessmentId: current.assessmentId, holdId: hold, reason: 'Synthetic release' }), { state: 'authorized', value: 'released' })
    assert.equal(await executeModerationJob(pool, newAssessment.jobIds[0], async () => 'allow'), 'completed')

    const historical = await create('transfer-history')
    const oldHold = (await pool.query("INSERT INTO moderator_holds(revision_id,kind,owner_id,placed_by,reason,released_by,released_at,release_reason) VALUES ($1,'escalation',$2,$3,'old hold',$3,clock_timestamp()-interval '91 days','old release') RETURNING id", [historical.revision, first, actor])).rows[0].id
    await pool.query("INSERT INTO moderator_escalation_transfers(hold_id,sequence,previous_owner_id,owner_id,actor_id,revision_id,reason,created_at) VALUES ($1,1,$2,$3,$3,$4,'old handoff',clock_timestamp()-interval '92 days')", [oldHold, first, actor, historical.revision])
    const director = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','director')", [director])
    await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic authority',$1)", [director])
    const legal = (await pool.query("SELECT public.place_legal_hold('firebase:demo-idea-map','director',$1,'synthetic-case','Synthetic preservation') AS id", [historical.idea])).rows[0].id
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_released_moderator_holds($1)', [historical.idea])).rows[0], { blocked: true, holds_deleted: 0 })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_escalation_transfers WHERE hold_id=$1', [oldHold])).rows[0].n, 1)
    await pool.query("SELECT public.release_legal_hold('firebase:demo-idea-map','director',$1,'Synthetic release',NULL)", [legal])
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_released_moderator_holds($1)', [historical.idea])).rows[0], { blocked: false, holds_deleted: 1 })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_escalation_transfers WHERE hold_id=$1', [oldHold])).rows[0].n, 0)
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
