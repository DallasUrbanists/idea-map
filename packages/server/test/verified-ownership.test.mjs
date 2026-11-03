import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { claimVerifiedOwnership, normalizeOwnershipEmail } from '../dist/verified-ownership.js'
import { evaluateTrustedShortcut, recordApprovedSubmission } from '../dist/approval-history.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

const verifier = (uid, email, verified = true) => ({
  async verifySessionCookie(cookie, revoked) { assert.equal(cookie, 'synthetic-cookie'); assert.equal(revoked, true); return { uid, email, email_verified: verified, firebase: { sign_in_provider: 'password' } } },
  async getUser() { return { uid, email, emailVerified: verified, disabled: false } },
})

test('email normalization never collapses aliases or local-part case', () => {
  assert.equal(normalizeOwnershipEmail('Foo+tag@EXAMPLE.TEST'), 'Foo+tag@example.test')
  assert.notEqual(normalizeOwnershipEmail('Foo+tag@example.test'), normalizeOwnershipEmail('foo@example.test'))
  for (const value of ['', 'x@@example.test', ' x@example.test', 'x@-example.test', 'x@example..test', 'x@example.test\n']) assert.equal(normalizeOwnershipEmail(value), null)
})

test('verified ownership claims are atomic, private, and tied to an authenticated identity', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `ownership_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('Foo+tag@example.test') RETURNING id")).rows[0].id
    const idea = async () => (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const target = await idea()
    const request = (subject, email, id = target, verified = true) => claimVerifiedOwnership(url, 'demo-idea-map', 'synthetic-cookie', verifier(subject, email, verified), id)
    assert.equal(await request('unverified', 'Foo+tag@example.test', target, false), 'forbidden')
    assert.equal(await request('wrong-case', 'foo+tag@example.test'), 'processed')
    assert.equal(await request('wrong-alias', 'Foo@example.test'), 'processed')
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM identities')).rows[0].n, 0)
    const missing = '11111111-1111-4111-8111-111111111111'
    assert.equal(await request('missing', 'Foo+tag@example.test', missing), 'processed')
    const changing = verifier('changing', 'Foo+tag@example.test')
    let checks = 0
    changing.getUser = async () => ({ uid: 'changing', email: 'Foo+tag@example.test', emailVerified: ++checks === 1, disabled: false })
    assert.equal(await claimVerifiedOwnership(url, 'demo-idea-map', 'synthetic-cookie', changing, target), 'forbidden')
    assert.equal((await pool.query('SELECT owner_id FROM ideas WHERE id=$1', [target])).rows[0].owner_id, null)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identities WHERE subject='changing'")).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ownership_claims WHERE idea_id=$1', [target])).rows[0].n, 0)
    const offline = verifier('offline', 'Foo+tag@example.test')
    let requests = 0
    const originalVerify = offline.verifySessionCookie
    offline.verifySessionCookie = async (...args) => { if (++requests > 1) throw new Error('synthetic provider outage'); return originalVerify(...args) }
    await assert.rejects(claimVerifiedOwnership(url, 'demo-idea-map', 'synthetic-cookie', offline, target), /Identity verification unavailable/)
    assert.equal((await pool.query('SELECT owner_id FROM ideas WHERE id=$1', [target])).rows[0].owner_id, null)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identities WHERE subject='offline'")).rows[0].n, 0)
    const stalled = verifier('stalled', 'Foo+tag@example.test')
    let lookups = 0
    const originalGetUser = stalled.getUser
    stalled.getUser = async (...args) => ++lookups === 1 ? originalGetUser(...args) : new Promise(() => {})
    await assert.rejects(claimVerifiedOwnership(url, 'demo-idea-map', 'synthetic-cookie', stalled, target), /Identity recheck timed out/)
    assert.equal((await pool.query('SELECT owner_id FROM ideas WHERE id=$1', [target])).rows[0].owner_id, null)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identities WHERE subject='stalled'")).rows[0].n, 0)
    assert.equal(await request('owner', 'Foo+tag@EXAMPLE.TEST'), 'processed')
    const owner = (await pool.query('SELECT owner_id, publication_state FROM ideas WHERE id=$1', [target])).rows[0]
    assert.ok(owner.owner_id)
    assert.equal(owner.publication_state, 'private')
    const evidence = (await pool.query('SELECT user_id,contact_id,verified_identity_id,verified_at FROM ownership_claims WHERE idea_id=$1', [target])).rows[0]
    assert.equal(evidence.user_id, owner.owner_id)
    assert.equal(evidence.contact_id, contact)
    assert.ok(evidence.verified_identity_id && evidence.verified_at)
    await assert.rejects(pool.query('UPDATE ownership_claims SET verified_at=NULL WHERE idea_id=$1', [target]), { code: '23514' })
    assert.equal((await pool.query('SELECT verified_at FROM contacts WHERE id=$1', [contact])).rows[0].verified_at, null)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE idea_id=$1 AND event_type='ownership_claimed'", [target])).rows[0].n, 1)
    assert.equal(await request('other', 'Foo+tag@example.test'), 'processed')
    assert.equal((await pool.query('SELECT owner_id FROM ideas WHERE id=$1', [target])).rows[0].owner_id, owner.owner_id)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM identities')).rows[0].n, 1)

    const first = await idea()
    const second = await idea()
    await Promise.all([request('same-subject', 'Foo+tag@example.test', first), request('same-subject', 'Foo+tag@example.test', second)])
    const owners = (await pool.query('SELECT owner_id FROM ideas WHERE id = ANY($1::uuid[])', [[first, second]])).rows.map(row => row.owner_id)
    assert.equal(owners.length, 2)
    assert.equal(owners[0], owners[1])
    assert.notEqual(owners[0], owner.owner_id)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identities WHERE subject='same-subject'")).rows[0].n, 1)

    const race = await idea()
    await Promise.all([request('race-a', 'Foo+tag@example.test', race), request('race-b', 'Foo+tag@example.test', race)])
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ownership_claims WHERE idea_id=$1', [race])).rows[0].n, 1)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE idea_id=$1 AND event_type='ownership_claimed'", [race])).rows[0].n, 1)
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM identities WHERE subject IN ('race-a','race-b')")).rows[0].n, 1)
    const withdrawn = await idea()
    await pool.query("UPDATE ideas SET publication_state='withdrawn' WHERE id=$1", [withdrawn])
    assert.equal(await request('withdrawn', 'Foo+tag@example.test', withdrawn), 'processed')
    assert.equal((await pool.query('SELECT owner_id FROM ideas WHERE id=$1', [withdrawn])).rows[0].owner_id, null)

    const prior = await idea()
    const past = await pool.connect()
    try {
      await past.query('BEGIN')
      const revision = (await past.query("INSERT INTO idea_revisions(idea_id,version,content,review_state) VALUES ($1,1,'{}','approved') RETURNING id", [prior])).rows[0].id
      await past.query("UPDATE ideas SET publication_state='approved' WHERE id=$1", [prior])
      await past.query('INSERT INTO approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [prior, revision])
      await recordApprovedSubmission(past, prior, revision)
      await past.query('COMMIT')
    } finally { past.release() }
    assert.equal(await request('owner', 'Foo+tag@example.test', prior), 'processed')
    assert.equal((await pool.query('SELECT publication_state FROM ideas WHERE id=$1', [prior])).rows[0].publication_state, 'approved')
    const trust = await pool.connect()
    try {
      await trust.query('BEGIN')
      assert.deepEqual(await evaluateTrustedShortcut(trust, target, { userId: owner.owner_id, identityId: evidence.verified_identity_id, verifiedEmail: 'Foo+tag@example.test', emailVerified: true }, 94.6), { eligible: true, priorApprovals: 1, threshold: 94.5 })
      await trust.query('COMMIT')
      await pool.query('UPDATE approval_records SET excluded_for_violation=true WHERE idea_id=$1', [prior])
      await trust.query('BEGIN')
      assert.deepEqual(await evaluateTrustedShortcut(trust, target, { userId: owner.owner_id, identityId: evidence.verified_identity_id, verifiedEmail: 'Foo+tag@example.test', emailVerified: true }, 94.6), { eligible: false, priorApprovals: 0, threshold: 95 })
      await trust.query('COMMIT')
    } finally { trust.release() }

    const current = await idea()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE ideas SET owner_id=$2 WHERE id=$1', [current, owner.owner_id])
      assert.deepEqual(await evaluateTrustedShortcut(client, current, { userId: owner.owner_id, identityId: evidence.verified_identity_id, verifiedEmail: 'Foo+tag@example.test', emailVerified: true }, 99), { eligible: false, priorApprovals: null, threshold: null })
      await client.query('ROLLBACK')
    } finally { client.release() }
    const other = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await assert.rejects(pool.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id,verified_identity_id,verified_at) VALUES ($1,$2,$3,$4,now())', [current, other, contact, evidence.verified_identity_id]), { code: '23503' })

    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT public.claim_verified_idea($1,$2,$3,$4)', ['firebase:demo-idea-map', 'forged', 'Foo+tag@example.test', current]), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.claim_verified_idea(text,text,text,uuid) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT * FROM ownership_claims'), { code: '42501' })
      await assert.rejects(limited.query('UPDATE ownership_claims SET verified_at=now()'), { code: '42501' })
      await assert.rejects(limited.query('UPDATE ideas SET owner_id=NULL'), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
