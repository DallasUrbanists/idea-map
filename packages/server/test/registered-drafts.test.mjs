import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { createRegisteredDraft, reviseRegisteredDraft, allocateRegisteredDraftMedia, finalizeRegisteredDraftMedia, freezeRegisteredDraft } from '../dist/registered-drafts.js'

const url = process.env.TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('Local disposable database required')
const verifier = (uid, provider = 'password') => ({
  async verifySessionCookie() { return { uid, email: `${uid}@example.invalid`, email_verified: true, firebase: { sign_in_provider: provider } } },
  async getUser() { return { uid, email: `${uid}@example.invalid`, emailVerified: true, disabled: false } },
})
const context = (uid, provider) => ({ databaseUrl: url, projectId: 'demo-idea-map', cookie: 'synthetic', verifier: verifier(uid, provider) })
const text = captions => ({ title: 'Synthetic crossing', description: 'Improve the crossing.', captions })

test('registered owner freezes an exact inventory; guest, stale, missing and conflicting evidence fail closed', async () => {
  const pool = new pg.Pool({ connectionString: url })
  const owner = context('owner'); const other = context('other'); const guest = context('guest', 'anonymous')
  const storage = new Map()
  const verify = async (name, generation) => storage.get(`${name}:${generation}`) ?? null
  try {
    assert.equal((await createRegisteredDraft(guest, randomUUID(), text([]))).state, 'unauthenticated')
    const key = randomUUID()
    const [created, same] = await Promise.all([createRegisteredDraft(owner, key, text(['Caption'])), createRegisteredDraft(owner, key, text(['Caption']))])
    assert.deepEqual(created, same)
    await assert.rejects(createRegisteredDraft(owner, key, text(['Different'])), /creation identity conflicts/)
    assert.equal(created.state, 'ok'); const { id, revision } = created.value
    assert.equal((await allocateRegisteredDraftMedia(other, id, revision, 0)).state, 'forbidden')
    assert.equal((await freezeRegisteredDraft(other, id, revision, verify)).state, 'forbidden')
    assert.equal((await freezeRegisteredDraft(owner, id, revision, verify)).state, 'incomplete')
    const [a, b] = await Promise.all([allocateRegisteredDraftMedia(owner, id, revision, 0), allocateRegisteredDraftMedia(owner, id, revision, 0)])
    assert.deepEqual(a, b); const asset = a.value
    assert.equal((await finalizeRegisteredDraftMedia(owner, id, revision, asset.id, '5', verify)).state, 'incomplete')
    storage.set(`${asset.objectName}:5`, { generation: '5', digest: 'a'.repeat(64) })
    assert.equal((await finalizeRegisteredDraftMedia(other, id, revision, asset.id, '5', verify)).state, 'forbidden')
    assert.equal((await finalizeRegisteredDraftMedia(owner, id, revision, asset.id, '5', verify)).state, 'ok')
    assert.equal((await finalizeRegisteredDraftMedia(owner, id, revision, asset.id, '5', verify)).state, 'ok')
    storage.set(`${asset.objectName}:6`, { generation: '6', digest: 'b'.repeat(64) })
    assert.equal((await finalizeRegisteredDraftMedia(owner, id, revision, asset.id, '6', verify)).state, 'stale')
    storage.delete(`${asset.objectName}:5`)
    assert.equal((await freezeRegisteredDraft(owner, id, revision, verify)).state, 'incomplete')
    storage.set(`${asset.objectName}:5`, { generation: '5', digest: 'a'.repeat(64) })
    const frozen = await freezeRegisteredDraft(owner, id, revision, verify)
    assert.equal(frozen.state, 'ok'); const manifest = JSON.parse(frozen.value.canonical)
    assert.equal(manifest.revision, revision); assert.equal(manifest.media[0].generation, '5'); assert.equal(manifest.media[0].caption, 'Caption')
    assert.deepEqual(await freezeRegisteredDraft(owner, id, revision, verify), frozen)
    storage.delete(`${asset.objectName}:5`)
    assert.equal((await freezeRegisteredDraft(owner, id, revision, verify)).state, 'incomplete')
    storage.set(`${asset.objectName}:5`, { generation: '5', digest: 'a'.repeat(64) })
    assert.deepEqual(await freezeRegisteredDraft(owner, id, revision, verify), frozen)
    assert.equal((await reviseRegisteredDraft(owner, id, revision, text([]))).state, 'stale')
    assert.equal((await allocateRegisteredDraftMedia(owner, id, revision, 0)).state, 'stale')
    await pool.query('UPDATE registered_drafts SET content=$2 WHERE id=$1', [id, JSON.stringify(text(['Corrupted']))])
    assert.equal((await freezeRegisteredDraft(owner, id, revision, verify)).state, 'incomplete')

    const changed = await createRegisteredDraft(owner, randomUUID(), text(['Old']))
    const old = await allocateRegisteredDraftMedia(owner, changed.value.id, 1, 0)
    const revised = await reviseRegisteredDraft(owner, changed.value.id, 1, text(['New']))
    assert.equal(revised.value.revision, 2)
    assert.equal((await freezeRegisteredDraft(owner, changed.value.id, 1, verify)).state, 'stale')
    assert.equal((await finalizeRegisteredDraftMedia(owner, changed.value.id, 1, old.value.id, '5', verify)).state, 'forbidden')
    assert.equal((await freezeRegisteredDraft(owner, changed.value.id, 2, verify)).state, 'incomplete')
    const inconsistent = await createRegisteredDraft(owner, randomUUID(), text(['Missing slot']))
    await pool.query('UPDATE registered_drafts SET expected_media=0 WHERE id=$1', [inconsistent.value.id])
    assert.equal((await freezeRegisteredDraft(owner, inconsistent.value.id, 1, verify)).state, 'incomplete')
    assert.equal((await pool.query('SELECT frozen_manifest FROM registered_drafts WHERE id=$1', [inconsistent.value.id])).rows[0].frozen_manifest, null)
    const empty = await createRegisteredDraft(owner, randomUUID(), text([]))
    assert.deepEqual(JSON.parse((await freezeRegisteredDraft(owner, empty.value.id, 1, verify)).value.canonical).media, [])
    await assert.rejects(pool.query('UPDATE registered_draft_media SET generation=\'7\', digest=NULL WHERE id=$1', [asset.id]), { code: '23514' })
  } finally { await pool.end() }
})

test('identity rechecks and revision races roll back or reject stale storage evidence', async () => {
  const pool = new pg.Pool({ connectionString: url })
  try {
    let calls = 0
    const changing = { ...context('changing'), verifier: {
      async verifySessionCookie() { calls++; return { uid: 'changing', email: 'changing@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } } },
      async getUser() { return { uid: 'changing', email: 'changing@example.invalid', emailVerified: true, disabled: calls > 1 } },
    } }
    await assert.rejects(createRegisteredDraft(changing, randomUUID(), text([])), /Identity changed/)
    assert.equal((await pool.query("SELECT count(*)::int n FROM registered_drafts WHERE subject='changing'")).rows[0].n, 0)
    const owner = context('racing')
    const draft = await createRegisteredDraft(owner, randomUUID(), text(['Caption']))
    const asset = await allocateRegisteredDraftMedia(owner, draft.value.id, 1, 0)
    let release; let signal
    const entered = new Promise(resolve => { signal = resolve })
    const wait = new Promise(resolve => { release = resolve })
    const pending = finalizeRegisteredDraftMedia(owner, draft.value.id, 1, asset.value.id, '9', async () => {
      signal(); await wait; return { generation: '9', digest: 'd'.repeat(64) }
    })
    await entered
    assert.equal((await reviseRegisteredDraft(owner, draft.value.id, 1, text(['New']))).state, 'ok')
    release()
    assert.equal((await pending).state, 'stale')
    const old = (await pool.query('SELECT generation,digest FROM registered_draft_media WHERE id=$1', [asset.value.id])).rows[0]
    assert.deepEqual(old, { generation: null, digest: null })
    const other = await createRegisteredDraft(owner, randomUUID(), text(['Different draft']))
    assert.equal((await finalizeRegisteredDraftMedia(owner, other.value.id, 1, asset.value.id, '9', async () => { throw new Error('must not inspect foreign asset') })).state, 'forbidden')
    const freezing = await createRegisteredDraft(owner, randomUUID(), text(['Freeze race']))
    const freezeAsset = await allocateRegisteredDraftMedia(owner, freezing.value.id, 1, 0)
    const good = async () => ({ generation: '12', digest: 'e'.repeat(64) })
    assert.equal((await finalizeRegisteredDraftMedia(owner, freezing.value.id, 1, freezeAsset.value.id, '12', good)).state, 'ok')
    let releaseFreeze; let signalFreeze
    const freezeEntered = new Promise(resolve => { signalFreeze = resolve })
    const freezeWait = new Promise(resolve => { releaseFreeze = resolve })
    const pendingFreeze = freezeRegisteredDraft(owner, freezing.value.id, 1, async () => { signalFreeze(); await freezeWait; return good() })
    await freezeEntered
    assert.equal((await reviseRegisteredDraft(owner, freezing.value.id, 1, text([]))).state, 'ok')
    releaseFreeze()
    assert.equal((await pendingFreeze).state, 'stale')
    assert.equal((await pool.query('SELECT frozen_manifest FROM registered_drafts WHERE id=$1', [freezing.value.id])).rows[0].frozen_manifest, null)

  } finally { await pool.end() }
})
