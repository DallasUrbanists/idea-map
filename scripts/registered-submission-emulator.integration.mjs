import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { requireLocalTestDatabase } from './local-test-database.mjs'
import { firebaseAdmin } from '../apps/web/server/utils/firebase-admin.ts'
import { allocateRegisteredDraftMedia, createRegisteredDraft, finalizeRegisteredDraftMedia, freezeRegisteredDraft, registeredSubmissionTermsVersion, submitRegisteredDraft } from '../packages/server/dist/registered-drafts.js'

const databaseUrl = requireLocalTestDatabase(process.env.TEST_DATABASE_URL)
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST
if (!/^(?:localhost|127\.0\.0\.1):\d{1,5}$/.test(host || '')) throw new Error('A local Firebase Auth emulator is required')
const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Pool } = require('pg')
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { deleteApp } = webRequire('firebase-admin/app')
const project = 'demo-idea-map'
const text = { title: 'Synthetic crossing', description: 'Improve the crossing.', captions: ['Synthetic image'] }
const storage = async (_name, generation) => ({ generation, digest: 'd'.repeat(64) })
const request = draftId => ({ draftId, revision: 1, key: randomUUID(), latitude: 32.77, longitude: -96.8, agreement: true, termsVersion: registeredSubmissionTermsVersion })

test('registered submission uses the application Firebase verifier and rejects changed identities', { timeout: 60000 }, async () => {
  const auth = firebaseAdmin(project, 'offline')
  const pool = new Pool({ connectionString: databaseUrl })
  const users = []
  const password = 'synthetic-password-123'
  async function requestAuth(method, body) {
    const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-key`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    assert.equal(response.status, 200, `emulator ${method} failed`)
    return response.json()
  }
  async function registered(verified) {
    const email = `submission-${randomUUID()}@example.test`
    const user = await auth.createUser({ email, password, emailVerified: verified })
    users.push(user.uid)
    const { idToken } = await requestAuth('signInWithPassword', { email, password, returnSecureToken: true })
    return { uid: user.uid, email, cookie: await auth.createSessionCookie(idToken, { expiresIn: 3600000 }) }
  }
  const context = user => ({ databaseUrl, projectId: project, cookie: user.cookie, verifier: auth })
  async function frozen(user) {
    const ctx = context(user)
    const draft = await createRegisteredDraft(ctx, randomUUID(), text)
    assert.equal(draft.state, 'ok')
    const asset = await allocateRegisteredDraftMedia(ctx, draft.value.id, 1, 0)
    assert.equal(asset.state, 'ok')
    assert.equal((await finalizeRegisteredDraftMedia(ctx, draft.value.id, 1, asset.value.id, '7', storage)).state, 'ok')
    assert.equal((await freezeRegisteredDraft(ctx, draft.value.id, 1, storage)).state, 'ok')
    return draft.value.id
  }
  try {
    const owner = await registered(true)
    const unverified = await registered(false)
    const foreign = await registered(true)
    const anonymous = await requestAuth('signUp', { returnSecureToken: true })
    users.push(anonymous.localId)
    const guest = { cookie: await auth.createSessionCookie(anonymous.idToken, { expiresIn: 3600000 }) }
    const id = await frozen(owner)
    const input = request(id)
    assert.equal((await submitRegisteredDraft(context(unverified), input, storage)).state, 'forbidden')
    assert.equal((await submitRegisteredDraft(context(guest), input, storage)).state, 'unauthenticated')
    assert.equal((await submitRegisteredDraft(context(foreign), input, storage)).state, 'forbidden')
    await assert.rejects(submitRegisteredDraft(context(owner), { ...input, ownerId: foreign.uid, email: foreign.email }, storage), /Invalid submission request/)
    const deniedSubjects = [unverified.uid, anonymous.localId, foreign.uid]
    assert.equal((await pool.query('SELECT count(*)::int n FROM identities WHERE subject=ANY($1::text[])', [deniedSubjects])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int n FROM registered_submissions WHERE draft_id=$1', [id])).rows[0].n, 0)
    const accepted = await submitRegisteredDraft(context(owner), input, storage)
    assert.equal(accepted.state, 'ok')
    const row = (await pool.query(`SELECT s.subject,i.owner_id,c.normalized_email,c.verified_at,identity.subject identity_subject,i.publication_state
      FROM registered_submissions s JOIN ideas i ON i.id=s.idea_id JOIN contacts c ON c.id=i.author_contact_id
      JOIN identities identity ON identity.user_id=i.owner_id WHERE s.draft_id=$1`, [id])).rows[0]
    assert.equal(row.subject, owner.uid); assert.equal(row.identity_subject, owner.uid); assert.equal(row.normalized_email, owner.email)
    assert.equal(row.verified_at, null); assert.equal(row.publication_state, 'private')
    assert.deepEqual(await submitRegisteredDraft(context(owner), input, storage), accepted)
    assert.equal((await pool.query('SELECT count(*)::int n FROM revision_assessments WHERE revision_id=$1', [accepted.value.revisionId])).rows[0].n, 0)
    const changing = await registered(true)
    const changingId = await frozen(changing)
    let release; let signal
    const entered = new Promise(resolve => { signal = resolve }); const wait = new Promise(resolve => { release = resolve })
    const pending = submitRegisteredDraft(context(changing), request(changingId), async (name, generation) => { signal(); await wait; return storage(name, generation) })
    await entered
    await auth.updateUser(changing.uid, { disabled: true })
    release()
    await assert.rejects(pending, /Identity changed during draft operation/)
    assert.equal((await pool.query('SELECT count(*)::int n FROM registered_submissions WHERE draft_id=$1', [changingId])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int n FROM identities WHERE subject=$1', [changing.uid])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int n FROM contacts WHERE normalized_email=$1', [changing.email])).rows[0].n, 0)
    const revoked = await registered(true)
    const revokedId = await frozen(revoked)
    let releaseRevoked; let signalRevoked
    const revokedEntered = new Promise(resolve => { signalRevoked = resolve }); const revokedWait = new Promise(resolve => { releaseRevoked = resolve })
    const revokedPending = submitRegisteredDraft(context(revoked), request(revokedId), async (name, generation) => { signalRevoked(); await revokedWait; return storage(name, generation) })
    await revokedEntered
    // Firebase token authentication times are whole seconds; cross that boundary before revocation.
    await new Promise(resolve => setTimeout(resolve, 1200))
    await auth.revokeRefreshTokens(revoked.uid)
    releaseRevoked()
    await assert.rejects(revokedPending, /Identity changed during draft operation/)
    assert.equal((await pool.query('SELECT count(*)::int n FROM registered_submissions WHERE draft_id=$1', [revokedId])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int n FROM identities WHERE subject=$1', [revoked.uid])).rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int n FROM contacts WHERE normalized_email=$1', [revoked.email])).rows[0].n, 0)
  } finally {
    const cleanup = await Promise.allSettled(users.map(uid => auth.deleteUser(uid)))
    await pool.end()
    await deleteApp(auth.app)
    assert.ok(cleanup.every(result => result.status === 'fulfilled'), 'Failed to delete a synthetic emulator account')
  }
})
