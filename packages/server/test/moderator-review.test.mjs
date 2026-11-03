import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readModeratorRevision } from '../dist/moderator-review.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('private review returns only the current pending revision to an active verified moderator', async () => {
  const pool = new pg.Pool({ connectionString: url })
  const role = `review_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const other = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator'),($2,'firebase:demo-idea-map','other')", [moderator, other])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic grant') RETURNING id", [moderator])).rows[0].id
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('private-contact@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id,owner_id) VALUES ($1,$2) RETURNING id', [contact, other])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{\"text\":\"synthetic content\"}') RETURNING id", [idea])).rows[0].id
    const verifier = uid => ({ async verifySessionCookie() { return { uid, email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'password' } } }, async getUser() { return { uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false } } })
    const args = [url, 'demo-idea-map', 'cookie', verifier('moderator')]
    assert.deepEqual(await readModeratorRevision(url, 'demo-idea-map', 'cookie', verifier('other'), revision), { state: 'forbidden' })
    let identityChecks = 0
    const disabled = { ...verifier('moderator'), async getUser() { return { uid: 'moderator', email: 'moderator@example.invalid', emailVerified: true, disabled: ++identityChecks > 1 } } }
    assert.deepEqual(await readModeratorRevision(url, 'demo-idea-map', 'cookie', disabled, revision), { state: 'unauthenticated' })
    const result = await readModeratorRevision(...args, revision)
    assert.equal(result.state, 'authorized')
    assert.deepEqual(result.value, { ideaId: idea, revisionId: revision, version: 1, content: { text: 'synthetic content' }, reviewState: 'waiting', assessmentId: null, assessmentReceivedAt: null, deadline: null, blocked: false, activeHoldCount: 0, activeChangeRequestCount: 0 })
    assert.equal(JSON.stringify(result).includes('private-contact@example.invalid'), false)
    assert.equal(JSON.stringify(result).includes(other), false)
    await pool.query("INSERT INTO moderator_holds(revision_id,placed_by,reason) VALUES ($1,$2,'synthetic hold')", [revision, moderator])
    const next = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,2,'{}') RETURNING id", [idea])).rows[0].id
    assert.deepEqual(await readModeratorRevision(...args, revision), { state: 'authorized', value: null })
    assert.equal((await readModeratorRevision(...args, next)).value.activeHoldCount, 1)
    const big = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,3,jsonb_build_object('text',repeat('x',262145))) RETURNING id", [idea])).rows[0].id
    await assert.rejects(readModeratorRevision(...args, big), /exceeds the supported size/)
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.read_moderator_revision('firebase:demo-idea-map','moderator',$1)", [big]), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM contacts'), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.read_moderator_revision(text,text,uuid) TO "${role}"`)
    const restrictedUrl = new URL(url)
    restrictedUrl.searchParams.set('options', `-c role=${role}`)
    const fresh = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,4,'{}') RETURNING id", [idea])).rows[0].id
    assert.equal((await readModeratorRevision(restrictedUrl.toString(), 'demo-idea-map', 'cookie', verifier('moderator'), fresh)).value.revisionId, fresh)
    await pool.query("UPDATE moderator_assignments SET revoked_at=clock_timestamp(),revoked_by=$1,revoke_reason='synthetic revocation' WHERE id=$2", [moderator, assignment])
    assert.deepEqual(await readModeratorRevision(...args, fresh), { state: 'forbidden' })
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
