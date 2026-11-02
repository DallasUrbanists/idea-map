import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { correctApprovalEligibility, evaluateTrustedShortcut, lockApprovalHistoryOwners, recordApprovedSubmission } from '../dist/approval-history.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('approval history counts distinct verified records and serializes corrections', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 5 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const owner = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const other = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const moderator = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const ownerIdentity = (await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','owner') RETURNING id", [owner])).rows[0].id
    const otherIdentity = (await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','other') RETURNING id", [other])).rows[0].id
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('trust@example.invalid') RETURNING id")).rows[0].id
    const idea = async (ownerId, approved) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const id = (await client.query('INSERT INTO ideas (author_contact_id,owner_id,publication_state) VALUES ($1,$2,$3) RETURNING id', [contact, ownerId, approved ? 'approved' : 'private'])).rows[0].id
        if (ownerId) await client.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id,verified_identity_id,verified_at) VALUES ($1,$2,$3,$4,now())', [id, ownerId, contact, ownerId === owner ? ownerIdentity : otherIdentity])
        const revision = (await client.query('INSERT INTO idea_revisions (idea_id,version,content,review_state) VALUES ($1,1,$2,$3) RETURNING id', [id, {}, approved ? 'approved' : 'waiting'])).rows[0].id
        if (approved) {
          await client.query('INSERT INTO approved_revisions (idea_id,revision_id) VALUES ($1,$2)', [id, revision])
          await recordApprovedSubmission(client, id, revision)
        }
        await client.query('COMMIT')
        return { id, revision }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    const current = await idea(owner, false)
    const evaluate = async (score, identity = { userId: owner, emailVerified: true }) => {
      const client = await pool.connect()
      try { await client.query('BEGIN'); const result = await evaluateTrustedShortcut(client, current.id, identity, score); await client.query('COMMIT'); return result }
      catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    assert.deepEqual(await evaluate(95), { eligible: false, priorApprovals: 0, threshold: 95 })
    assert.deepEqual(await evaluate(99, { userId: owner, emailVerified: false }), { eligible: false, priorApprovals: null, threshold: null })
    assert.deepEqual(await evaluate(99, { userId: other, emailVerified: true }), { eligible: false, priorApprovals: null, threshold: null })
    await pool.query('UPDATE ownership_claims SET verified_identity_id=NULL, verified_at=NULL WHERE idea_id=$1', [current.id])
    assert.deepEqual(await evaluate(99), { eligible: false, priorApprovals: null, threshold: null })
    await pool.query('UPDATE ownership_claims SET verified_identity_id=$2, verified_at=now() WHERE idea_id=$1', [current.id, ownerIdentity])
    const priors = []
    for (let n = 0; n < 5; n++) priors.push(await idea(owner, true))
    await pool.query('UPDATE ownership_claims SET verified_identity_id=NULL, verified_at=NULL WHERE idea_id=$1', [priors[0].id])
    assert.deepEqual(await evaluate(99), { eligible: false, priorApprovals: null, threshold: null })
    await pool.query('UPDATE ownership_claims SET verified_identity_id=$2, verified_at=now() WHERE idea_id=$1', [priors[0].id, ownerIdentity])
    await idea(other, true)
    assert.deepEqual(await evaluate(92.5), { eligible: false, priorApprovals: 5, threshold: 92.5 })
    assert.equal((await evaluate(92.6)).eligible, true)
    const reapproval = await pool.connect()
    try {
      await reapproval.query('BEGIN')
      const revision = (await reapproval.query("INSERT INTO idea_revisions (idea_id,version,content,review_state) VALUES ($1,2,'{}','approved') RETURNING id", [priors[0].id])).rows[0].id
      await reapproval.query('UPDATE approved_revisions SET revision_id = $2 WHERE idea_id = $1', [priors[0].id, revision])
      await recordApprovedSubmission(reapproval, priors[0].id, revision)
      await reapproval.query('COMMIT')
    } finally { reapproval.release() }
    assert.equal((await evaluate(92.6)).priorApprovals, 5)
    for (let n = 0; n < 6; n++) priors.push(await idea(owner, true))
    assert.deepEqual(await evaluate(90), { eligible: false, priorApprovals: 11, threshold: 90 })
    assert.equal((await evaluate(90.1)).eligible, true)
    const correction = { ideaId: priors[0].id, actorId: moderator, excluded: true, reason: 'Synthetic correction' }
    await assert.rejects(correctApprovalEligibility(pool, correction, async () => false), /authorization/)
    assert.equal(await correctApprovalEligibility(pool, correction, async () => true), true)
    assert.equal(await correctApprovalEligibility(pool, correction, async () => true), false)
    assert.equal((await evaluate(95)).priorApprovals, 10)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_corrections WHERE idea_id = $1', [priors[0].id])).rows[0].n, 1)
    assert.equal(await correctApprovalEligibility(pool, { ...correction, excluded: false }, async () => true), true)
    assert.equal((await evaluate(95)).priorApprovals, 11)

    await pool.query('UPDATE approval_records SET verified_for_trust = false WHERE idea_id = $1', [priors[0].id])
    assert.deepEqual(await evaluate(99), { eligible: false, priorApprovals: null, threshold: null })
    assert.equal(await correctApprovalEligibility(pool, { ...correction, excluded: false }, async () => true), true)
    assert.equal((await evaluate(95)).priorApprovals, 11)
    await pool.query("UPDATE ideas SET publication_state = 'withdrawn' WHERE id = $1", [priors[0].id])
    assert.equal((await evaluate(95)).priorApprovals, 11)

    const reader = await pool.connect()
    try {
      await reader.query('BEGIN')
      await evaluateTrustedShortcut(reader, current.id, { userId: owner, emailVerified: true }, 95)
      let authorized
      const started = new Promise(resolve => { authorized = resolve })
      const pending = correctApprovalEligibility(pool, { ...correction, excluded: true }, async () => { authorized(); return true })
      await started
      assert.equal(await Promise.race([pending.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]), false)
      await reader.query('COMMIT')
      assert.equal(await pending, true)
    } finally { reader.release() }
    assert.equal((await evaluate(95)).priorApprovals, 10)
    const unclaimed = await idea(null, true)
    const otherCurrent = await idea(other, false)
    const claim = await pool.connect()
    try {
      await claim.query('BEGIN')
      await claim.query('SELECT id FROM ideas WHERE id = $1 FOR UPDATE', [unclaimed.id])
      await lockApprovalHistoryOwners(claim, [other])
      await claim.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id,verified_identity_id,verified_at) VALUES ($1,$2,$3,$4,now())', [unclaimed.id, other, contact, otherIdentity])
      await claim.query('UPDATE ideas SET owner_id = $2 WHERE id = $1 AND owner_id IS NULL', [unclaimed.id, other])
      await claim.query('COMMIT')
      await claim.query('BEGIN')
      assert.equal((await evaluateTrustedShortcut(claim, otherCurrent.id, { userId: other, emailVerified: true }, 95)).priorApprovals, 2)
      await claim.query('COMMIT')
    } finally { claim.release() }
  } finally { await pool.end() }
})
