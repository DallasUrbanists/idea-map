import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { placeLegalHold, recordLegalHoldDisposition, releaseLegalHold } from '../dist/legal-holds.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('released hold deadlines require current authority, preserve amendments, and do not delete records', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `disposition_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const director = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const other = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','director'),($2,'firebase:demo-idea-map','other')", [director, other])
    const authority = (await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic authorization',$1) RETURNING id", [director])).rows[0].id
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('disposition@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const verifier = uid => ({ async verifySessionCookie() { return { uid, email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'password' } } }, async getUser() { return { uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false } } })
    const args = [url, 'demo-idea-map', 'cookie', verifier('director')]
    await placeLegalHold(...args, { ideaId: idea, caseReference: 'synthetic-case', reason: 'Synthetic preservation' })
    const holdId = (await pool.query('SELECT id FROM legal_holds WHERE idea_id=$1', [idea])).rows[0].id
    const input = { holdId, expectedSequence: 0, deleteBy: '2032-03-12', basis: 'synthetic legal requirement', legalReviewReference: 'synthetic-review' }
    assert.deepEqual(await recordLegalHoldDisposition(...args, input), { state: 'processed', outcome: 'not-released' })
    assert.deepEqual(await recordLegalHoldDisposition(url, 'demo-idea-map', 'cookie', verifier('other'), input), { state: 'forbidden' })
    await assert.rejects(recordLegalHoldDisposition(...args, { ...input, deleteBy: '2032-02-30' }), /Invalid/)
    await assert.rejects(recordLegalHoldDisposition(...args, { ...input, basis: 'bad\nline' }), /Invalid/)
    await releaseLegalHold(...args, { holdId, reason: 'Synthetic release', legalReviewReference: null })
    assert.deepEqual(await recordLegalHoldDisposition(...args, input), { state: 'processed', outcome: 'recorded' })
    assert.deepEqual(await recordLegalHoldDisposition(...args, input), { state: 'processed', outcome: 'stale' })
    let identityChecks = 0
    const changedIdentity = { ...verifier('director'), async getUser() { return { uid: 'director', email: 'director@example.invalid', emailVerified: true, disabled: ++identityChecks > 1 } } }
    assert.deepEqual(await recordLegalHoldDisposition(url, 'demo-idea-map', 'cookie', changedIdentity, { ...input, expectedSequence: 1 }), { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM legal_hold_disposition_dates WHERE hold_id=$1', [holdId])).rows[0].n, 1)
    assert.deepEqual(await recordLegalHoldDisposition(...args, { ...input, expectedSequence: 1, deleteBy: '2033-04-13', basis: 'synthetic amended basis', legalReviewReference: null }), { state: 'processed', outcome: 'recorded' })
    const records = (await pool.query('SELECT sequence,delete_by::text,basis,legal_review_reference,actor_id,authority_id FROM legal_hold_disposition_dates WHERE hold_id=$1 ORDER BY sequence', [holdId])).rows
    assert.deepEqual(records, [
      { sequence: 1, delete_by: '2032-03-12', basis: 'synthetic legal requirement', legal_review_reference: 'synthetic-review', actor_id: director, authority_id: authority },
      { sequence: 2, delete_by: '2033-04-13', basis: 'synthetic amended basis', legal_review_reference: null, actor_id: director, authority_id: authority },
    ])
    await assert.rejects(pool.query("UPDATE legal_hold_disposition_dates SET basis='changed' WHERE hold_id=$1", [holdId]), /cannot be updated or deleted/)
    await assert.rejects(pool.query('DELETE FROM legal_hold_disposition_dates WHERE hold_id=$1', [holdId]), /cannot be updated or deleted/)
    await assert.rejects(pool.query('DELETE FROM legal_holds WHERE id=$1', [holdId]), /cannot be deleted/)
    const concurrent = await Promise.all([
      recordLegalHoldDisposition(...args, { ...input, expectedSequence: 2, deleteBy: '2034-01-01' }),
      recordLegalHoldDisposition(...args, { ...input, expectedSequence: 2, deleteBy: '2035-01-01' }),
    ])
    assert.deepEqual(concurrent.map(result => result.outcome).sort(), ['recorded', 'stale'])
    const repeatable = await pool.connect()
    try {
      await repeatable.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      await assert.rejects(repeatable.query("SELECT public.record_legal_hold_disposition('firebase:demo-idea-map','director',$1,3,'2036-01-01','synthetic',NULL)", [holdId]), /read committed/)
      await repeatable.query('ROLLBACK')
    } finally { repeatable.release() }
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query("SELECT public.record_legal_hold_disposition('firebase:demo-idea-map','director',$1,3,'2036-01-01','synthetic',NULL)", [holdId]), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM legal_hold_disposition_dates'), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_legal_hold_authority(text,text), public.record_legal_hold_disposition(text,text,uuid,integer,date,text,text) TO "${role}"`)
    const restrictedUrl = new URL(url)
    restrictedUrl.searchParams.set('options', `-c role=${role}`)
    assert.deepEqual(await recordLegalHoldDisposition(restrictedUrl.toString(), 'demo-idea-map', 'cookie', verifier('director'), { ...input, expectedSequence: 3 }), { state: 'processed', outcome: 'recorded' })
    await pool.query("UPDATE legal_hold_assignments SET revoked_by=$1,revoked_at=clock_timestamp(),revoke_reason='synthetic revocation' WHERE id=$2", [director, authority])
    assert.deepEqual(await recordLegalHoldDisposition(...args, { ...input, expectedSequence: 4 }), { state: 'forbidden' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM legal_holds WHERE id=$1', [holdId])).rows[0].n, 1)
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
