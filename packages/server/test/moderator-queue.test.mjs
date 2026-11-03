import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { listModeratorQueue } from '../dist/moderator-review.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('private queue pages only current pending metadata with exact cursor precision', async () => {
  const pool = new pg.Pool({ connectionString: url })
  const role = `queue_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const user = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const other = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','moderator'),($2,'firebase:demo-idea-map','other')", [user, other])
    const assignment = (await pool.query("INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic') RETURNING id", [user])).rows[0].id
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('private-queue@example.invalid') RETURNING id")).rows[0].id
    const ideas = (await pool.query('INSERT INTO ideas(author_contact_id) SELECT $1 FROM generate_series(1,52) RETURNING id', [contact])).rows.map(row => row.id)
    const revisions = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content,created_at) SELECT id,1,'{\"text\":\"private synthetic content\"}'::jsonb,'2031-01-01T12:00:00.123456Z' FROM ideas WHERE id=ANY($1::uuid[]) RETURNING id", [ideas])).rows.map(row => row.id).sort()
    const verifier = uid => ({ async verifySessionCookie() { return { uid, email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'password' } } }, async getUser() { return { uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false } } })
    const args = [url, 'demo-idea-map', 'cookie', verifier('moderator')]
    assert.deepEqual(await listModeratorQueue(url, 'demo-idea-map', 'cookie', verifier('other'), null), { state: 'forbidden' })
    const first = await listModeratorQueue(...args, null)
    assert.equal(first.state, 'authorized')
    assert.equal(first.value.entries.length, 50)
    assert.equal(first.value.entries[0].createdAt, '2031-01-01T12:00:00.123456Z')
    assert.deepEqual(first.value.entries.map(item => item.revisionId), revisions.slice(0, 50))
    assert.deepEqual(first.value.next, { createdAt: '2031-01-01T12:00:00.123456Z', revisionId: revisions[49] })
    const second = await listModeratorQueue(...args, first.value.next)
    assert.deepEqual(second.value.entries.map(item => item.revisionId), revisions.slice(50))
    assert.equal(second.value.next, null)
    assert.equal(JSON.stringify(first).includes('private-queue@example.invalid'), false)
    assert.equal(JSON.stringify(first).includes('private synthetic content'), false)
    const replacement = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content,created_at) VALUES ($1,2,'{}','2031-01-01T13:00:00Z') RETURNING id", [ideas[0]])).rows[0].id
    await pool.query("UPDATE ideas SET publication_state='withdrawn' WHERE id=$1", [ideas[1]])
    await pool.query("UPDATE idea_revisions SET review_state='rejected' WHERE idea_id=$1", [ideas[2]])
    const all = await listModeratorQueue(...args, null)
    const more = all.value.next ? await listModeratorQueue(...args, all.value.next) : null
    const listed = [...all.value.entries, ...(more?.value.entries ?? [])].map(row => row.revisionId)
    assert.equal(listed.length, 50)
    assert.ok(listed.includes(replacement))
    assert.equal(listed.includes((await pool.query('SELECT id FROM idea_revisions WHERE idea_id=$1 AND version=1', [ideas[0]])).rows[0].id), false)
    await assert.rejects(listModeratorQueue(...args, { revisionId: 'invalid', createdAt: '2031-01-01T12:00:00.123456Z' }), /Invalid/)
    await assert.rejects(listModeratorQueue(...args, { revisionId: revisions[0], createdAt: '2031-02-30T12:00:00.123456Z' }), /Invalid/)
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT * FROM public.list_moderator_queue('firebase:demo-idea-map','moderator',NULL,NULL)"), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM idea_revisions'), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.list_moderator_queue(text,text,timestamptz,uuid) TO "${role}"`)
    const restricted = new URL(url)
    restricted.searchParams.set('options', `-c role=${role}`)
    assert.equal((await listModeratorQueue(restricted.toString(), 'demo-idea-map', 'cookie', verifier('moderator'), null)).state, 'authorized')
    await pool.query("UPDATE moderator_assignments SET revoked_at=clock_timestamp(),revoked_by=$1,revoke_reason='synthetic' WHERE id=$2", [user, assignment])
    assert.deepEqual(await listModeratorQueue(...args, null), { state: 'forbidden' })
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
