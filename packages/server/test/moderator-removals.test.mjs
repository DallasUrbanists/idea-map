import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { removePublishedIdea } from '../dist/moderator-removals.js'
import { recordAcceptedAssessment, executeModerationJob } from '../dist/moderation-jobs.js'
import { readPublishedIdea } from '../dist/published-ideas.js'
import { readMediaPreview } from '../dist/media-preview.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('moderator removal atomically hides the approved idea and creates an invalidation intent', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `removal_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const owner = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator')", [moderator])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic grant') RETURNING id", [moderator])).rows[0].id
    const session = { uid: 'moderator', email: 'moderator@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verify = { async verifySessionCookie() { return session }, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: false } } }
    const other = { ...verify, async verifySessionCookie() { return { ...session, uid: 'other' } }, async getUser() { return { uid: 'other', email: session.email, emailVerified: true, disabled: false } } }
    const args = [url, 'demo-idea-map', 'synthetic-cookie', verify]
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('removal@example.invalid') RETURNING id")).rows[0].id
    const create = async id => {
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id,owner_id) VALUES ($1,$2) RETURNING id', [contact, owner])).rows[0].id
      const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,$2) RETURNING id", [idea, { title: 'Synthetic title', description: 'Synthetic description' }])).rows[0].id
      const assessment = await recordAcceptedAssessment(pool, { id, revisionId: revision, fingerprint: 'a'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
      assert.equal(await executeModerationJob(pool, assessment.jobIds[0], async () => 'allow'), 'completed')
      const preview = (await pool.query("INSERT INTO media_previews(idea_id,revision_id,object_name,generation,content_type,published) VALUES ($1,$2,$3,'1','image/png',true) RETURNING id", [idea, revision, `synthetic/${id}`])).rows[0].id
      return { idea, revision, preview, input: { ideaId: idea, approvedRevisionId: revision, classification: 'violation', reason: 'Synthetic violation' } }
    }
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])
    const storage = { bucket() { return { file() { return { interceptors: [], async getMetadata() { return [{ generation: '1', size: String(image.length), contentType: 'image/png' }] }, createReadStream() { return Readable.from([image]) } } } } } }
    const target = await create('remove-target')
    assert.deepEqual(await readPublishedIdea(url, target.idea), { title: 'Synthetic title', description: 'Synthetic description' })
    assert.ok(await readMediaPreview(pool, storage, 'synthetic-approved', target.preview, 100))
    assert.deepEqual(await removePublishedIdea(url, 'demo-idea-map', 'synthetic-cookie', other, target.input), { state: 'forbidden' })
    assert.deepEqual(await removePublishedIdea(...args, { ...target.input, approvedRevisionId: '11111111-1111-4111-8111-111111111111' }), { state: 'authorized', value: 'stale' })
    let calls = 0
    const disabled = { ...verify, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: ++calls > 1 } } }
    assert.deepEqual(await removePublishedIdea(url, 'demo-idea-map', 'synthetic-cookie', disabled, target.input), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [target.idea])).rows[0].publication_state, 'approved')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_removals WHERE idea_id=$1', [target.idea])).rows[0].n, 0)

    const director = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','director')", [director])
    await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic authority',$1)", [director])
    const legal = (await pool.query("SELECT public.place_legal_hold('firebase:demo-idea-map','director',$1,'synthetic-case','Synthetic preservation') AS id", [target.idea])).rows[0].id
    const pending = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [target.idea])).rows[0].id
    const next = await recordAcceptedAssessment(pool, { id: 'pending-edit', revisionId: pending, fingerprint: 'b'.repeat(64), waitMilliseconds: 0, shortcutRequested: false })
    const tx = await pool.connect()
    try {
      await tx.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      assert.equal((await tx.query("SELECT public.remove_published_idea('firebase:demo-idea-map','moderator',$1,$2,'violation','Synthetic violation') AS result", [target.idea, target.revision])).rows[0].result, 'removed')
      const publication = executeModerationJob(pool, next.jobIds[0], async () => 'allow')
      assert.equal(await Promise.race([publication.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await tx.query('COMMIT')
      assert.equal(await publication, 'stale')
    } finally { await tx.query('ROLLBACK'); tx.release() }
    assert.equal(await readPublishedIdea(url, target.idea), null)
    assert.equal(await readMediaPreview(pool, storage, 'synthetic-approved', target.preview, 100), null)
    assert.equal((await pool.query('SELECT published FROM media_previews WHERE id=$1', [target.preview])).rows[0].published, false)
    assert.equal((await pool.query('SELECT excluded_for_violation FROM approval_records WHERE idea_id=$1', [target.idea])).rows[0].excluded_for_violation, true)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_corrections WHERE idea_id=$1 AND excluded', [target.idea])).rows[0].n, 1)
    const removed = (await pool.query('SELECT * FROM moderator_removals WHERE idea_id=$1', [target.idea])).rows[0]
    assert.equal(removed.actor_id, moderator)
    assert.equal(removed.revision_id, target.revision)
    assert.equal(removed.classification, 'violation')
    assert.equal((await pool.query('SELECT kind FROM jobs WHERE id=$1', [removed.projection_job_id])).rows[0].kind, 'projection')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM outbox WHERE job_id=$1', [removed.projection_job_id])).rows[0].n, 1)
    assert.deepEqual(await removePublishedIdea(...args, target.input), { state: 'authorized', value: 'stale' })
    await assert.rejects(pool.query("UPDATE moderator_removals SET reason='changed' WHERE id=$1", [removed.id]), /cannot be updated/)

    // An old synthetic removal is retained during a legal hold and pruned only after release.
    await pool.query("INSERT INTO moderator_removals(idea_id,revision_id,actor_id,classification,reason,projection_job_id,created_at) VALUES ($1,$2,$3,'other','old synthetic',$4,clock_timestamp()-interval '91 days')", [target.idea, target.revision, moderator, removed.projection_job_id])
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_moderator_removals($1)', [target.idea])).rows[0], { blocked: true, removals_deleted: 0 })
    await pool.query("SELECT public.release_legal_hold('firebase:demo-idea-map','director',$1,'Synthetic release',NULL)", [legal])
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_moderator_removals($1)', [target.idea])).rows[0], { blocked: false, removals_deleted: 1 })
    assert.equal((await pool.query('SELECT excluded_for_violation FROM approval_records WHERE idea_id=$1', [target.idea])).rows[0].excluded_for_violation, true)

    const rollback = await create('remove-rollback')
    await pool.query("INSERT INTO jobs(kind,idempotency_key,scheduled_at) VALUES ('collision',$1,now())", [`removal:${rollback.idea}:${rollback.revision}`])
    await assert.rejects(removePublishedIdea(...args, rollback.input), /projection identity conflicts/)
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [rollback.idea])).rows[0].publication_state, 'approved')
    assert.equal((await pool.query('SELECT published FROM media_previews WHERE id=$1', [rollback.preview])).rows[0].published, true)
    assert.equal((await pool.query('SELECT excluded_for_violation FROM approval_records WHERE idea_id=$1', [rollback.idea])).rows[0].excluded_for_violation, false)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_removals WHERE idea_id=$1', [rollback.idea])).rows[0].n, 0)

    const restrictedItem = await create('remove-other')
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.remove_published_idea('firebase:demo-idea-map','moderator',$1,$2,'other','Synthetic')", [restrictedItem.idea, restrictedItem.revision]), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text),public.remove_published_idea(text,text,uuid,uuid,text,text) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT * FROM moderator_removals'), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM public.prune_moderator_removals($1)', [restrictedItem.idea]), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    const restricted = new URL(url)
    restricted.searchParams.set('options', `-c role=${role}`)
    assert.deepEqual(await removePublishedIdea(restricted.toString(), 'demo-idea-map', 'synthetic-cookie', verify, { ...restrictedItem.input, classification: 'other' }), { state: 'authorized', value: 'removed' })
    assert.equal((await pool.query('SELECT excluded_for_violation FROM approval_records WHERE idea_id=$1', [restrictedItem.idea])).rows[0].excluded_for_violation, false)
    await pool.query("UPDATE moderator_assignments SET revoked_by=$1,revoked_at=now(),revoke_reason='synthetic revoke' WHERE id=$2", [moderator, assignment])
    assert.deepEqual(await removePublishedIdea(...args, rollback.input), { state: 'forbidden' })
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
