import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { escalateModerationRevision } from '../dist/moderator-escalations.js'
import { placeModeratorHold, releaseModeratorHold } from '../dist/moderator-holds.js'
import { executeModerationJob, recordAcceptedAssessment } from '../dist/moderation-jobs.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('owned escalation holds survive edits, respect independent blocks, and retain audit evidence', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `escalation_test_${randomBytes(8).toString('hex')}`
  const migrations = await mkdtemp(join(tmpdir(), 'idea-map-escalation-migrations-'))
  let roleCreated = false
  try {
    await cp(resolve('migrations'), migrations, { recursive: true })
    const journalPath = join(migrations, 'meta', '_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.entries = journal.entries.slice(0, 22)
    await writeFile(journalPath, JSON.stringify(journal))
    await migrate(drizzle(pool), { migrationsFolder: migrations })
    const actor = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const owner = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const outsider = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('escalation@example.invalid') RETURNING id")).rows[0].id
    const legacyIdea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const legacyRevision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [legacyIdea])).rows[0].id
    const legacyHold = (await pool.query("INSERT INTO moderator_holds(revision_id,placed_by,reason) VALUES ($1,$2,'existing synthetic hold') RETURNING id", [legacyRevision, actor])).rows[0].id
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    assert.deepEqual((await pool.query('SELECT kind,owner_id,reason FROM moderator_holds WHERE id=$1', [legacyHold])).rows[0], { kind: 'hold', owner_id: null, reason: 'existing synthetic hold' })
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator')", [actor])
    await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic actor'),($2,$1,'synthetic owner')", [actor, owner])
    const session = { uid: 'moderator', email: 'moderator@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verify = { async verifySessionCookie() { return session }, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: false } } }
    const other = { ...verify, async verifySessionCookie() { return { ...session, uid: 'other' } }, async getUser() { return { uid: 'other', email: session.email, emailVerified: true, disabled: false } } }
    const args = [url, 'demo-idea-map', 'synthetic-cookie', verify]
    const create = async id => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
      const assessment = await recordAcceptedAssessment(pool, { id, revisionId: revision, fingerprint: 'a'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
      return { idea, revision, job: assessment.jobIds[0], input: { revisionId: revision, assessmentId: id, ownerId: owner, reason: 'Synthetic escalation' } }
    }
    const item = await create('escalation-before-edit')
    assert.deepEqual(await escalateModerationRevision(url, 'demo-idea-map', 'synthetic-cookie', other, item.input), { state: 'forbidden' })
    assert.deepEqual(await escalateModerationRevision(...args, { ...item.input, ownerId: outsider }), { state: 'authorized', value: 'owner-unavailable' })
    assert.deepEqual(await escalateModerationRevision(...args, { ...item.input, assessmentId: 'stale' }), { state: 'authorized', value: 'stale' })
    let calls = 0
    const disabled = { ...verify, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: ++calls > 1 } } }
    assert.deepEqual(await escalateModerationRevision(url, 'demo-idea-map', 'synthetic-cookie', disabled, item.input), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1', [item.revision])).rows[0].n, 0)
    assert.deepEqual(await placeModeratorHold(...args, { ...item.input, operationKey: 'escalation-hold' }), { state: 'authorized', value: 'placed' })
    assert.deepEqual(await escalateModerationRevision(...args, item.input), { state: 'authorized', value: 'escalated' })
    assert.deepEqual(await escalateModerationRevision(...args, item.input), { state: 'authorized', value: 'already-escalated' })
    const holds = (await pool.query('SELECT id,kind,owner_id,placed_by FROM moderator_holds WHERE revision_id=$1 ORDER BY kind', [item.revision])).rows
    const escalation = holds.find(row => row.kind === 'escalation')
    const ordinary = holds.find(row => row.kind === 'hold')
    assert.equal(escalation.owner_id, owner)
    assert.equal(escalation.placed_by, actor)
    await assert.rejects(pool.query('UPDATE moderator_holds SET owner_id=$2 WHERE id=$1', [escalation.id, outsider]), /Only release/)
    assert.deepEqual(await releaseModeratorHold(...args, { ...item.input, holdId: ordinary.id }), { state: 'authorized', value: 'released' })
    await assert.rejects(executeModerationJob(pool, item.job, async () => 'allow'), /on hold/)
    const edited = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [item.idea])).rows[0].id
    const newer = await recordAcceptedAssessment(pool, { id: 'escalation-after-edit', revisionId: edited, fingerprint: 'b'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    await assert.rejects(executeModerationJob(pool, newer.jobIds[0], async () => 'allow'), /on hold/)
    const ownerLockItem = await create('owner-revocation-race')
    const ownerLock = await pool.connect()
    try {
      await ownerLock.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      assert.equal((await ownerLock.query("SELECT public.escalate_moderation_revision('firebase:demo-idea-map','moderator',$1,$2,$3,'Synthetic owner lock') AS result", [ownerLockItem.revision, ownerLockItem.input.assessmentId, owner])).rows[0].result, 'escalated')
      const revoke = pool.query("UPDATE moderator_assignments SET revoked_by=$1,revoked_at=now(),revoke_reason='synthetic revocation' WHERE user_id=$2 AND revoked_at IS NULL", [actor, owner])
      assert.equal(await Promise.race([revoke.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await ownerLock.query('COMMIT')
      await revoke
    } finally { await ownerLock.query('ROLLBACK'); ownerLock.release() }
    await assert.rejects(executeModerationJob(pool, newer.jobIds[0], async () => 'allow'), /on hold/)
    assert.deepEqual(await releaseModeratorHold(...args, { ...item.input, revisionId: edited, assessmentId: 'escalation-after-edit', holdId: escalation.id }), { state: 'authorized', value: 'released' })
    assert.equal(await executeModerationJob(pool, newer.jobIds[0], async () => 'allow'), 'completed')

    const restrictedItem = await create('restricted-escalation')
    assert.deepEqual(await escalateModerationRevision(...args, restrictedItem.input), { state: 'authorized', value: 'owner-unavailable' })
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.escalate_moderation_revision('firebase:demo-idea-map','moderator',$1,$2,$3,'Synthetic')", [restrictedItem.revision, restrictedItem.input.assessmentId, actor]), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.escalate_moderation_revision(text,text,uuid,text,uuid,text) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT * FROM moderator_holds'), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM public.prune_released_moderator_holds($1)', [item.idea]), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    const restricted = new URL(url)
    restricted.searchParams.set('options', `-c role=${role}`)
    assert.deepEqual(await escalateModerationRevision(restricted.toString(), 'demo-idea-map', 'synthetic-cookie', verify, { ...restrictedItem.input, ownerId: actor }), { state: 'authorized', value: 'escalated' })

    const race = await create('escalation-race')
    const tx = await pool.connect()
    try {
      await tx.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      assert.equal((await tx.query("SELECT public.escalate_moderation_revision('firebase:demo-idea-map','moderator',$1,$2,$3,'Synthetic race') AS result", [race.revision, race.input.assessmentId, actor])).rows[0].result, 'escalated')
      const publication = executeModerationJob(pool, race.job, async () => 'allow')
      assert.equal(await Promise.race([publication.then(() => 'finished', () => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await tx.query('COMMIT')
      await assert.rejects(publication, /on hold/)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM jobs WHERE kind='projection' AND revision_id=$1", [race.revision])).rows[0].n, 0)
    } finally { await tx.query('ROLLBACK'); tx.release() }

    await pool.query("INSERT INTO moderator_holds(revision_id,placed_by,reason,released_by,released_at,release_reason) VALUES ($1,$2,'old synthetic hold',$2,clock_timestamp()-interval '91 days','old release')", [race.revision, actor])
    const director = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','director')", [director])
    await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic authority',$1)", [director])
    const legal = (await pool.query("SELECT public.place_legal_hold('firebase:demo-idea-map','director',$1,'synthetic-case','Synthetic hold') AS id", [race.idea])).rows[0].id
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_released_moderator_holds($1)', [race.idea])).rows[0], { blocked: true, holds_deleted: 0 })
    await pool.query("SELECT public.release_legal_hold('firebase:demo-idea-map','director',$1,'Synthetic release',NULL)", [legal])
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_released_moderator_holds($1)', [race.idea])).rows[0], { blocked: false, holds_deleted: 1 })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1 AND released_at IS NULL', [race.revision])).rows[0].n, 1)
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
    await rm(migrations, { recursive: true, force: true })
  }
})
