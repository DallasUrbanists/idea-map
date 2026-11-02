import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { consumeGuestVerification, issueGuestVerification } from '../dist/guest-verification.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('guest email proof is bound, expiring, single-use, and separate from ownership and publication', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 8 })
  const role = `guest_verify_test_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const key = randomBytes(32)
    const allow = async () => true
    const create = async suffix => {
      const contact = (await pool.query('INSERT INTO contacts(normalized_email) VALUES ($1) RETURNING id', [`${suffix}@example.invalid`])).rows[0].id
      const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
      return { idea, contact }
    }
    const first = await create('first')
    await assert.rejects(issueGuestVerification(pool, first.idea, Buffer.alloc(8), 600, allow), /Invalid/)
    await assert.rejects(issueGuestVerification(pool, first.idea, key, 86401, allow), /Invalid/)
    assert.deepEqual(await issueGuestVerification(pool, first.idea, key, 600, async () => false), { state: 'unavailable' })
    await assert.rejects(issueGuestVerification(pool, first.idea, key, 600, async () => { throw new Error('synthetic authorization failure') }), /synthetic authorization failure/)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM guest_email_verifications')).rows[0].n, 0)
    const issued = await issueGuestVerification(pool, first.idea, key, 600, allow)
    assert.equal(issued.state, 'issued')
    assert.equal(issued.recipient, 'first@example.invalid')
    assert.match(issued.token, /^v1\./)
    assert.ok(issued.expiresAt.getTime() > Date.now())
    const stored = (await pool.query('SELECT * FROM guest_email_verifications WHERE idea_id=$1', [first.idea])).rows[0]
    assert.equal(JSON.stringify(stored).includes(issued.token), false)
    assert.equal(JSON.stringify(stored).includes(issued.recipient), false)
    assert.equal(await consumeGuestVerification(pool, `${issued.token.slice(0, -1)}${issued.token.endsWith('A') ? 'B' : 'A'}`, key), false)
    assert.equal(await consumeGuestVerification(pool, issued.token, randomBytes(32)), false)
    assert.equal(await consumeGuestVerification(pool, 'invalid', key), false)
    const outcomes = await Promise.all([consumeGuestVerification(pool, issued.token, key), consumeGuestVerification(pool, issued.token, key)])
    assert.deepEqual(outcomes.sort(), [false, true])
    assert.equal(await consumeGuestVerification(pool, issued.token, key), false)
    const after = (await pool.query('SELECT i.owner_id,i.publication_state,c.verified_at FROM ideas i JOIN contacts c ON c.id=i.author_contact_id WHERE i.id=$1', [first.idea])).rows[0]
    assert.equal(after.owner_id, null)
    assert.equal(after.publication_state, 'private')
    assert.ok(after.verified_at instanceof Date)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_records WHERE idea_id=$1', [first.idea])).rows[0].n, 0)
    await pool.query("UPDATE contacts SET normalized_email='replacement@example.invalid',verified_at=clock_timestamp() WHERE id=$1", [first.contact])
    assert.equal((await pool.query('SELECT verified_at FROM contacts WHERE id=$1', [first.contact])).rows[0].verified_at, null)
    const siblings = await create('siblings')
    const a = await issueGuestVerification(pool, siblings.idea, key, 600, allow)
    const b = await issueGuestVerification(pool, siblings.idea, key, 600, allow)
    assert.deepEqual((await Promise.all([consumeGuestVerification(pool, a.token, key), consumeGuestVerification(pool, b.token, key)])).sort(), [false, true])
    assert.equal(await consumeGuestVerification(pool, b.token, key), false)
    const changed = await create('changed')
    const original = await issueGuestVerification(pool, changed.idea, key, 600, allow)
    await pool.query("UPDATE contacts SET normalized_email='different@example.invalid' WHERE id=$1", [changed.contact])
    assert.equal(await consumeGuestVerification(pool, original.token, key), false)
    await pool.query("UPDATE contacts SET normalized_email='changed@example.invalid' WHERE id=$1", [changed.contact])
    assert.equal(await consumeGuestVerification(pool, original.token, key), false)
    assert.equal((await pool.query('SELECT verified_at FROM contacts WHERE id=$1', [changed.contact])).rows[0].verified_at, null)
    const sharedIdea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [changed.contact])).rows[0].id
    const sharedA = await issueGuestVerification(pool, changed.idea, key, 600, allow)
    const sharedB = await issueGuestVerification(pool, sharedIdea, key, 600, allow)
    await pool.query("UPDATE contacts SET normalized_email='replaced@example.invalid' WHERE id=$1", [changed.contact])
    assert.equal(await consumeGuestVerification(pool, sharedA.token, key), false)
    assert.equal(await consumeGuestVerification(pool, sharedB.token, key), false)
    const expired = await create('expired')
    const old = await issueGuestVerification(pool, expired.idea, key, 600, allow)
    await pool.query("UPDATE guest_email_verifications SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE idea_id=$1", [expired.idea])
    assert.equal(await consumeGuestVerification(pool, old.token, key), false)
    const active = await issueGuestVerification(pool, expired.idea, key, 600, allow)
    const director = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','legal-director')", [director])
    await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic',$1)", [director])
    const legal = (await pool.query("SELECT public.place_legal_hold('firebase:demo-idea-map','legal-director',$1,'synthetic-case','synthetic hold') AS id", [expired.idea])).rows[0].id
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_expired_guest_verifications($1)', [expired.idea])).rows[0], { blocked: true, tokens_deleted: 0 })
    await pool.query("SELECT public.release_legal_hold('firebase:demo-idea-map','legal-director',$1,'synthetic release',NULL)", [legal])
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_expired_guest_verifications($1)', [expired.idea])).rows[0], { blocked: false, tokens_deleted: 1 })
    assert.equal(await consumeGuestVerification(pool, active.token, key), true)
    const withdrawn = await create('withdrawn')
    const pending = await issueGuestVerification(pool, withdrawn.idea, key, 600, allow)
    await pool.query("UPDATE ideas SET publication_state='withdrawn' WHERE id=$1", [withdrawn.idea])
    assert.equal(await consumeGuestVerification(pool, pending.token, key), false)
    const claimed = await create('claimed')
    const claimToken = await issueGuestVerification(pool, claimed.idea, key, 600, allow)
    await pool.query('UPDATE ideas SET owner_id=$1 WHERE id=$2', [director, claimed.idea])
    assert.equal(await consumeGuestVerification(pool, claimToken.token, key), false)
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT * FROM guest_email_verifications'), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM public.lock_guest_verification_target($1)', [first.idea]), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_guest_verification_target(uuid), public.create_guest_verification(uuid,uuid,uuid,text,text,integer), public.lock_guest_verification(uuid,text), public.consume_guest_verification(uuid,text,text) TO "${role}"`)
    const restrictedUrl = new URL(url)
    restrictedUrl.searchParams.set('options', `-c role=${role}`)
    const restrictedPool = new pg.Pool({ connectionString: restrictedUrl.toString() })
    try {
      const restricted = await create('restricted')
      await assert.rejects(restrictedPool.query('SELECT * FROM contacts'), { code: '42501' })
      await assert.rejects(restrictedPool.query('SELECT * FROM public.prune_expired_guest_verifications($1)', [restricted.idea]), { code: '42501' })
      const proof = await issueGuestVerification(restrictedPool, restricted.idea, key, 600, allow)
      assert.equal(await consumeGuestVerification(restrictedPool, proof.token, key), true)
    } finally { await restrictedPool.end() }
    const race = await create('race')
    let resume
    let started
    const entered = new Promise(resolve => { started = resolve })
    const wait = new Promise(resolve => { resume = resolve })
    const issuance = issueGuestVerification(pool, race.idea, key, 600, async () => { started(); await wait; return true })
    await entered
    const withdrawal = pool.query("UPDATE ideas SET publication_state='withdrawn' WHERE id=$1", [race.idea])
    assert.equal(await Promise.race([withdrawal.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
    resume()
    const raceProof = await issuance
    await withdrawal
    assert.equal(await consumeGuestVerification(pool, raceProof.token, key), false)
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
