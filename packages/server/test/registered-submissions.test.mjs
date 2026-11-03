import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'
import { allocateRegisteredDraftMedia, createRegisteredDraft, finalizeRegisteredDraftMedia, freezeRegisteredDraft, registeredSubmissionTermsVersion, reviseRegisteredDraft, submitRegisteredDraft } from '../dist/registered-drafts.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('Local disposable database required')
const verifier = (uid, provider = 'password') => ({
  async verifySessionCookie() { return { uid, email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: provider } } },
  async getUser() { return { uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false } },
})
const context = (uid, provider) => ({ databaseUrl: url, projectId: 'demo-idea-map', cookie: 'synthetic', verifier: verifier(uid, provider) })
const text = { title: 'Synthetic crossing', description: 'Improve the crossing.', captions: ['Synthetic caption'] }
const good = async (_name, generation) => ({ generation, digest: 'a'.repeat(64) })
async function frozenDraft(owner) {
  const draft = await createRegisteredDraft(owner, randomUUID(), text)
  const asset = await allocateRegisteredDraftMedia(owner, draft.value.id, 1, 0)
  assert.equal((await finalizeRegisteredDraftMedia(owner, draft.value.id, 1, asset.value.id, '42', good)).state, 'ok')
  const frozen = await freezeRegisteredDraft(owner, draft.value.id, 1, good)
  assert.equal(frozen.state, 'ok')
  return { id: draft.value.id, asset: asset.value, canonical: frozen.value.canonical }
}
const request = id => ({ draftId: id, revision: 1, key: randomUUID(), latitude: 32.77, longitude: -96.8, agreement: true, termsVersion: registeredSubmissionTermsVersion })

test('frozen registered draft becomes one private revision with retained consent and exact replay', async () => {
  const pool = new pg.Pool({ connectionString: url }); const owner = context('submit-owner'); const other = context('submit-other')
  try {
    const draft = await frozenDraft(owner); const input = request(draft.id)
    assert.equal((await submitRegisteredDraft(other, input, good)).state, 'forbidden')
    assert.equal((await submitRegisteredDraft(context('guest', 'anonymous'), input, good)).state, 'unauthenticated')
    await assert.rejects(submitRegisteredDraft(owner, { ...input, agreement: false }, good), /Invalid submission request/)
    await assert.rejects(submitRegisteredDraft(owner, { ...input, termsVersion: 'wrong' }, good), /Invalid submission terms/)
    await assert.rejects(submitRegisteredDraft(owner, { ...input, latitude: 91 }, good), /Invalid submission request/)
    const [a, b] = await Promise.all([submitRegisteredDraft(owner, input, good), submitRegisteredDraft(owner, input, good)])
    assert.equal(a.state, 'ok'); assert.deepEqual(a, b)
    const row = (await pool.query(`SELECT s.*,i.owner_id,i.publication_state,ST_X(i.location::geometry) lon,ST_Y(i.location::geometry) lat,
      c.normalized_email,c.verified_at,r.content,r.review_state FROM registered_submissions s JOIN ideas i ON i.id=s.idea_id
      JOIN contacts c ON c.id=i.author_contact_id JOIN idea_revisions r ON r.id=s.revision_id WHERE s.draft_id=$1`, [draft.id])).rows[0]
    assert.equal(row.publication_state, 'private'); assert.equal(row.review_state, 'waiting')
    assert.equal(row.lat, input.latitude); assert.equal(row.lon, input.longitude)
    assert.equal(row.normalized_email, 'submit-owner@example.invalid'); assert.equal(row.verified_at, null)
    assert.equal(row.terms_version, input.termsVersion); assert.equal(row.accepted_at.toISOString(), a.value.acceptedAt.toISOString())
    assert.equal(`sha256:${createHash('sha256').update(row.terms_text).digest('hex')}`, row.terms_version)
    assert.equal(row.terms_text, await readFile(new URL('../terms/initial-terms.md', import.meta.url), 'utf8'))
    assert.equal(row.terms_text, await readFile(new URL('../../../docs/policies/terms-of-use-policy.md', import.meta.url), 'utf8'))
    assert.deepEqual(row.content.frozenManifest, JSON.parse(draft.canonical))
    assert.equal((await pool.query('SELECT count(*)::int n FROM identities WHERE user_id=$1 AND subject=$2', [row.owner_id, 'submit-owner'])).rows[0].n, 1)
    for (const table of ['revision_assessments', 'jobs', 'approved_revisions']) assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE ${table === 'approved_revisions' ? 'idea_id' : 'revision_id'}=$1`, [table === 'approved_revisions' ? a.value.ideaId : a.value.revisionId])).rows[0].n, 0)
    assert.deepEqual(await submitRegisteredDraft(owner, input, async () => { throw new Error('replay must not access storage') }), a)
    let replayChecks = 0
    owner.verifier.getUser = async uid => ({ uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: ++replayChecks > 1 })
    await assert.rejects(submitRegisteredDraft(owner, input, good), /Identity changed during submission/)
    owner.verifier = verifier('submit-owner')
    await assert.rejects(submitRegisteredDraft(owner, { ...input, longitude: -96.7 }, good), /conflicts/)
    await assert.rejects(submitRegisteredDraft(owner, { ...input, key: randomUUID() }, good), /already submitted/)
    assert.equal((await pool.query('SELECT count(*)::int n FROM registered_submissions WHERE draft_id=$1', [draft.id])).rows[0].n, 1)
  } finally { await pool.end() }
})

test('unfrozen, stale and missing or inconsistent media cannot create a submission', async () => {
  const pool = new pg.Pool({ connectionString: url }); const owner = context('submit-missing')
  try {
    const draft = await createRegisteredDraft(owner, randomUUID(), text); const input = request(draft.value.id)
    assert.equal((await submitRegisteredDraft(owner, input, good)).state, 'incomplete')
    assert.equal((await reviseRegisteredDraft(owner, input.draftId, 1, text)).state, 'ok')
    assert.notEqual((await submitRegisteredDraft(owner, input, good)).state, 'ok')
    const frozen = await frozenDraft(owner); const next = request(frozen.id)
    assert.equal((await submitRegisteredDraft(owner, next, async () => null)).state, 'incomplete')
    await pool.query("UPDATE registered_draft_media SET digest=$2 WHERE id=$1", [frozen.asset.id, 'b'.repeat(64)])
    assert.equal((await submitRegisteredDraft(owner, next, good)).state, 'incomplete')
    assert.equal((await pool.query('SELECT count(*)::int n FROM registered_submissions WHERE subject=$1', ['submit-missing'])).rows[0].n, 0)
  } finally { await pool.end() }
})

test('revocation after storage verification rolls back identity, contact, idea and consent writes', async () => {
  const pool = new pg.Pool({ connectionString: url }); const owner = context('submit-revoke')
  try {
    const draft = await frozenDraft(owner); const input = request(draft.id); let calls = 0
    owner.verifier.getUser = async uid => ({ uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: ++calls >= 4 })
    await assert.rejects(submitRegisteredDraft(owner, input, good), /Identity changed during submission/)
    assert.equal((await pool.query('SELECT count(*)::int n FROM identities WHERE subject=$1', ['submit-revoke'])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int n FROM contacts WHERE normalized_email=$1', ['submit-revoke@example.invalid'])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int n FROM registered_submissions WHERE draft_id=$1', [draft.id])).rows[0].n, 0)
  } finally { await pool.end() }
})

test('media changed while verification is in flight cannot be submitted', async () => {
  const pool = new pg.Pool({ connectionString: url }); const owner = context('submit-race')
  try {
    const draft = await frozenDraft(owner); let release; let signal
    const entered = new Promise(resolve => { signal = resolve }); const wait = new Promise(resolve => { release = resolve })
    const pending = submitRegisteredDraft(owner, request(draft.id), async (_name, generation) => { signal(); await wait; return { generation, digest: 'a'.repeat(64) } })
    await entered
    await pool.query('UPDATE registered_draft_media SET digest=$2 WHERE id=$1', [draft.asset.id, 'b'.repeat(64)])
    release()
    assert.equal((await pending).state, 'incomplete')
    assert.equal((await pool.query('SELECT count(*)::int n FROM registered_submissions WHERE draft_id=$1', [draft.id])).rows[0].n, 0)
  } finally { await pool.end() }
})
