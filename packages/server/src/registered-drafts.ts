import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type pg from 'pg'
import { runtimeDatabasePool } from './runtime-database.js'
import { verifyRegisteredSession, type RegisteredSessionVerifier } from './moderator-authorization.js'
import { normalizeOwnershipEmail } from './verified-ownership.js'

type Context = { databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier }
type DraftText = { title: string, description: string, captions: string[] }
type Result<T> = { state: 'unauthenticated' | 'forbidden' | 'stale' | 'incomplete' } | { state: 'ok', value: T }
type DraftRow = { id: string, provider: string, subject: string, revision: number, content: DraftText, expected_media: number, frozen_manifest: unknown | null }
type AssetRow = { id: string, revision: number, slot: number, object_name: string, generation: string | null, digest: string | null }
/** A trusted server adapter must verify the exact immutable generation and its bytes. Never use browser assertions. */
export type DraftStorageVerifier = (objectName: string, generation: string) => Promise<{ generation: string, digest: string } | null>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = /^[a-f0-9]{64}$/
const generationPattern = /^[1-9][0-9]*$/
function validContent(content: DraftText): boolean {
  return !!content && typeof content.title === 'string' && typeof content.description === 'string' &&
    Array.isArray(content.captions) && content.captions.length <= 10 && content.captions.every(c => typeof c === 'string') &&
    Object.keys(content).sort().join(',') === 'captions,description,title' && Buffer.byteLength(JSON.stringify(content)) <= 262144
}
async function session(context: Context) {
  if (!context.databaseUrl) throw new Error('Invalid draft configuration')
  return verifyRegisteredSession(context.projectId, context.cookie, context.verifier)
}
async function current(context: Context, expected: { uid: string, email: string }): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([session(context), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Identity recheck timed out')), 5000) })])
    return result.state === 'verified' && result.uid === expected.uid && result.email === expected.email
  } finally { if (timer) clearTimeout(timer) }
}
async function transact<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try { await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); await client.query("SET LOCAL lock_timeout = '5s'"); await client.query("SET LOCAL statement_timeout = '10s'"); const value = await work(client); await client.query('COMMIT'); return value }
  catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
async function owned(client: pg.PoolClient, id: string, projectId: string, uid: string): Promise<DraftRow | null> {
  const result = await client.query<DraftRow>('SELECT * FROM registered_drafts WHERE id=$1 AND provider=$2 AND subject=$3 FOR UPDATE', [id, `firebase:${projectId}`, uid])
  return result.rows[0] ?? null
}
function validateId(id: string, revision?: number) {
  if (!uuid.test(id) || (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1 || revision >= 2147483647))) throw new Error('Invalid draft request')
}
/** Create a private registered draft; verifier must be the configured server-side identity provider. */
export async function createRegisteredDraft(context: Context, creationKey: string, content: DraftText): Promise<Result<{ id: string, revision: number }>> {
  validateId(creationKey)
  if (!context.databaseUrl || !validContent(content)) throw new Error('Invalid draft request')
  const snapshot = { title: content.title, description: content.description, captions: [...content.captions] }
  const creationDigest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  const identity = await session(context)
  if (identity.state !== 'verified') return identity
  return transact(runtimeDatabasePool(context.databaseUrl), async client => {
    await client.query(`INSERT INTO registered_drafts(provider,subject,creation_key,creation_digest,content,expected_media,revision)
      VALUES ($1,$2,$3,$4,$5,$6,1) ON CONFLICT (provider,subject,creation_key) DO NOTHING`,
    [`firebase:${context.projectId}`, identity.uid, creationKey, creationDigest, JSON.stringify(snapshot), snapshot.captions.length])
    const row = await client.query<{ id: string, creation_digest: string }>(
      'SELECT id,creation_digest FROM registered_drafts WHERE provider=$1 AND subject=$2 AND creation_key=$3 FOR UPDATE', [`firebase:${context.projectId}`, identity.uid, creationKey])
    if (row.rows[0].creation_digest !== creationDigest) throw new Error('Draft creation identity conflicts with existing input')
    if (!await current(context, identity)) throw new Error('Identity changed during draft operation')
    // Draft creation always starts at revision 1, even after later revisions.
    return { state: 'ok', value: { id: row.rows[0].id, revision: 1 } }
  })
}
/** Replace an unfrozen draft revision; stale and frozen requests cannot change its manifest. */
export async function reviseRegisteredDraft(context: Context, id: string, revision: number, content: DraftText): Promise<Result<{ revision: number }>> {
  validateId(id, revision)
  if (!validContent(content)) throw new Error('Invalid draft request')
  const snapshot = { title: content.title, description: content.description, captions: [...content.captions] }
  const identity = await session(context)
  if (identity.state !== 'verified') return identity
  return transact(runtimeDatabasePool(context.databaseUrl), async client => {
    const draft = await owned(client, id, context.projectId, identity.uid)
    if (!draft) return { state: 'forbidden' }
    if (draft.revision !== revision || draft.frozen_manifest !== null) return { state: 'stale' }
    const updated = await client.query<{ revision: number }>('UPDATE registered_drafts SET revision=revision+1,content=$2,expected_media=$3 WHERE id=$1 RETURNING revision', [id, JSON.stringify(snapshot), snapshot.captions.length])
    if (!await current(context, identity)) throw new Error('Identity changed during draft operation')
    return { state: 'ok', value: updated.rows[0] }
  })
}
/** Reserve one private object identity for an authorized current draft slot; retries preserve it. */
export async function allocateRegisteredDraftMedia(context: Context, id: string, revision: number, slot: number): Promise<Result<{ id: string, objectName: string }>> {
  validateId(id, revision)
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) throw new Error('Invalid draft slot')
  const identity = await session(context)
  if (identity.state !== 'verified') return identity
  return transact(runtimeDatabasePool(context.databaseUrl), async client => {
    const draft = await owned(client, id, context.projectId, identity.uid)
    if (!draft) return { state: 'forbidden' }
    if (draft.revision !== revision || draft.frozen_manifest !== null) return { state: 'stale' }
    if (slot >= draft.expected_media) return { state: 'incomplete' }
    const result = await client.query<{ id: string, object_name: string }>(`INSERT INTO registered_draft_media(draft_id,revision,slot,object_name)
      VALUES ($1,$2,$3,$4) ON CONFLICT (draft_id,revision,slot) DO UPDATE SET slot=EXCLUDED.slot RETURNING id,object_name`, [id, revision, slot, `pending/${randomUUID()}`])
    if (!await current(context, identity)) throw new Error('Identity changed during draft operation')
    return { state: 'ok', value: { id: result.rows[0].id, objectName: result.rows[0].object_name } }
  })
}
/** Verify a generation with a trusted storage adapter, then recheck identity and draft under lock. */
export async function finalizeRegisteredDraftMedia(context: Context, id: string, revision: number, assetId: string, generation: string,
  verify: DraftStorageVerifier): Promise<Result<{ id: string }>> {
  validateId(id, revision); validateId(assetId)
  if (!generationPattern.test(generation)) throw new Error('Invalid media generation')
  const identity = await session(context)
  if (identity.state !== 'verified') return identity
  const pool = runtimeDatabasePool(context.databaseUrl)
  const candidate = await pool.query<{ object_name: string }>(`SELECT m.object_name FROM registered_draft_media m JOIN registered_drafts d ON d.id=m.draft_id
    WHERE m.id=$1 AND d.id=$2 AND d.provider=$3 AND d.subject=$4 AND d.revision=$5 AND m.revision=$5 AND d.frozen_manifest IS NULL`,
  [assetId, id, `firebase:${context.projectId}`, identity.uid, revision])
  if (!candidate.rowCount) return { state: 'forbidden' }
  const name = candidate.rows[0].object_name
  const evidence = await verify(name, generation)
  if (!evidence || evidence.generation !== generation || !digest.test(evidence.digest)) return { state: 'incomplete' }
  return transact(pool, async client => {
    const draft = await owned(client, id, context.projectId, identity.uid)
    if (!draft) return { state: 'forbidden' }
    if (draft.revision !== revision || draft.frozen_manifest !== null) return { state: 'stale' }
    const result = await client.query<AssetRow>('SELECT * FROM registered_draft_media WHERE id=$1 AND draft_id=$2 AND revision=$3 FOR UPDATE', [assetId, id, revision])
    const asset = result.rows[0]
    if (!asset || asset.object_name !== name) return { state: 'incomplete' }
    if (asset.generation !== null && (asset.generation !== generation || asset.digest !== evidence.digest)) return { state: 'stale' }
    if (asset.generation === null) await client.query('UPDATE registered_draft_media SET generation=$2,digest=$3 WHERE id=$1', [assetId, generation, evidence.digest])
    if (!await current(context, identity)) throw new Error('Identity changed during draft operation')
    return { state: 'ok', value: { id: assetId } }
  })
}

/** Freeze a canonical private inventory, not an accepted assessment or a public submission. */
export async function freezeRegisteredDraft(context: Context, id: string, revision: number, verify: DraftStorageVerifier): Promise<Result<{ canonical: string }>> {
  validateId(id, revision)
  const identity = await session(context)
  if (identity.state !== 'verified') return identity
  const pool = runtimeDatabasePool(context.databaseUrl)
  const initial = await pool.query<DraftRow>('SELECT * FROM registered_drafts WHERE id=$1 AND provider=$2 AND subject=$3', [id, `firebase:${context.projectId}`, identity.uid])
  const observed = initial.rows[0]
  if (!observed) return { state: 'forbidden' }
  if (observed.revision !== revision) return { state: 'stale' }
  if (!validContent(observed.content) || observed.content.captions.length !== observed.expected_media) return { state: 'incomplete' }
  const result = await pool.query<AssetRow>('SELECT * FROM registered_draft_media WHERE draft_id=$1 AND revision=$2 ORDER BY slot', [id, revision])
  const assets = result.rows
  if (assets.length !== observed.expected_media || assets.some((asset, slot) => asset.slot !== slot || !asset.generation || !asset.digest)) return { state: 'incomplete' }
  for (const asset of assets) {
    const evidence = await verify(asset.object_name, asset.generation!)
    if (!evidence || evidence.generation !== asset.generation || evidence.digest !== asset.digest) return { state: 'incomplete' }
  }
  return transact(pool, async client => {
    const draft = await owned(client, id, context.projectId, identity.uid)
    if (!draft) return { state: 'forbidden' }
    if (draft.revision !== revision) return { state: 'stale' }
    if (!validContent(draft.content) || draft.content.captions.length !== draft.expected_media) return { state: 'incomplete' }
    const locked = await client.query<AssetRow>('SELECT * FROM registered_draft_media WHERE draft_id=$1 AND revision=$2 ORDER BY slot FOR UPDATE', [id, revision])
    if (locked.rows.length !== draft.expected_media || locked.rows.length !== assets.length || locked.rows.some((asset, i) => {
      const prior = assets[i]
      return asset.slot !== i || asset.id !== prior.id || asset.object_name !== prior.object_name || asset.generation !== prior.generation || asset.digest !== prior.digest || !asset.generation || !asset.digest
    })) return { state: 'incomplete' }
    const content = draft.content
    const canonical = JSON.stringify({ version: 1, draftId: draft.id, revision, text: { title: content.title, description: content.description },
      media: locked.rows.map((asset, i) => ({ slot: i, caption: content.captions[i], objectName: asset.object_name, generation: asset.generation, digest: asset.digest })) })
    if (draft.frozen_manifest !== null) {
      if (draft.frozen_manifest !== canonical) return { state: 'incomplete' }
      if (!await current(context, identity)) throw new Error('Identity changed during draft operation')
      return { state: 'ok', value: { canonical } }
    }
    await client.query('UPDATE registered_drafts SET frozen_manifest=$2 WHERE id=$1', [id, canonical])
    if (!await current(context, identity)) throw new Error('Identity changed during draft operation')
    return { state: 'ok', value: { canonical } }
  })
}

// The retained bytes identify the exact terms presented for this submission.
export const registeredSubmissionTermsVersion = 'sha256:155c2837ea919a462704fe6d48e4cf529c07b61cd7cd726fe6f03bc87bf882c2'
function submissionTerms(): string {
  const text = readFileSync(new URL('../terms/initial-terms.md', import.meta.url), 'utf8')
  if (`sha256:${createHash('sha256').update(text).digest('hex')}` !== registeredSubmissionTermsVersion) throw new Error('Submission terms unavailable')
  return text
}

type SubmissionRequest = { draftId: string, revision: number, key: string, latitude: number, longitude: number, agreement: boolean, termsVersion: string }
type SubmissionResult = { ideaId: string, revisionId: string, acceptedAt: Date }
type PriorSubmission = { request_digest: string, idea_id: string, revision_id: string, accepted_at: Date }

/** Accept one registered frozen draft privately. This does not create an assessment or publish. */
export async function submitRegisteredDraft(context: Context, request: SubmissionRequest, verify: DraftStorageVerifier): Promise<Result<SubmissionResult>> {
  if (!request || typeof request !== 'object') throw new Error('Invalid submission request')
  const { draftId, revision, key, latitude, longitude, agreement, termsVersion } = request
  validateId(draftId, revision); validateId(key)
  if (Object.keys(request).sort().join(',') !== 'agreement,draftId,key,latitude,longitude,revision,termsVersion' ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      agreement !== true || typeof termsVersion !== 'string') throw new Error('Invalid submission request')
  const requestDigest = createHash('sha256').update(JSON.stringify([draftId.toLowerCase(), revision, latitude, longitude, agreement, termsVersion])).digest('hex')
  const identity = await session(context)
  if (identity.state !== 'verified') return identity
  const email = normalizeOwnershipEmail(identity.email)
  if (!email) return { state: 'forbidden' }
  const pool = runtimeDatabasePool(context.databaseUrl)
  const provider = `firebase:${context.projectId}`
  const prior = async (client: pg.PoolClient): Promise<SubmissionResult | null> => {
    const result = await client.query<PriorSubmission>('SELECT request_digest,idea_id,revision_id,accepted_at FROM registered_submissions WHERE provider=$1 AND subject=$2 AND submission_key=$3', [provider, identity.uid, key])
    if (!result.rowCount) return null
    const row = result.rows[0]
    if (row.request_digest !== requestDigest) throw new Error('Submission identity conflicts with existing input')
    return { ideaId: row.idea_id, revisionId: row.revision_id, acceptedAt: row.accepted_at }
  }
  // A completed replay must not depend on current storage or the current terms version.
  const replay = await transact(pool, async client => {
    const saved = await prior(client)
    if (saved && !await current(context, identity)) throw new Error('Identity changed during submission')
    return saved
  })
  if (replay) return { state: 'ok', value: replay }
  if (termsVersion !== registeredSubmissionTermsVersion) throw new Error('Invalid submission terms')
  const termsText = submissionTerms()
  const observed = await pool.query<{ frozen_manifest: string | null }>(
    'SELECT frozen_manifest FROM registered_drafts WHERE id=$1 AND provider=$2 AND subject=$3 AND revision=$4', [draftId, provider, identity.uid, revision])
  if (!observed.rowCount) return { state: 'forbidden' }
  if (!observed.rows[0].frozen_manifest) return { state: 'incomplete' }
  // Storage I/O occurs before the transaction; freeze rechecks the immutable generation and digest.
  const frozen = await freezeRegisteredDraft(context, draftId, revision, verify)
  if (frozen.state !== 'ok') return frozen
  if (frozen.value.canonical !== observed.rows[0].frozen_manifest) return { state: 'incomplete' }
  return transact(pool, async client => {
    // Match claim_verified_idea's JSONB lock key so both paths serialize identity creation.
    await client.query(`SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(pg_catalog.jsonb_build_array($1::text, $2::text)::text, 0))`, [provider, identity.uid])
    const saved = await prior(client)
    if (saved) {
      if (!await current(context, identity)) throw new Error('Identity changed during submission')
      return { state: 'ok', value: saved }
    }
    const draft = await owned(client, draftId, context.projectId, identity.uid)
    if (!draft) return { state: 'forbidden' }
    if (draft.revision !== revision) return { state: 'stale' }
    if (!validContent(draft.content) || draft.frozen_manifest !== frozen.value.canonical || draft.content.captions.length !== draft.expected_media) return { state: 'incomplete' }
    const assets = (await client.query<AssetRow>('SELECT * FROM registered_draft_media WHERE draft_id=$1 AND revision=$2 ORDER BY slot FOR UPDATE', [draft.id, revision])).rows
    if (assets.length !== draft.expected_media || assets.some((a, i) => a.slot !== i || !a.generation || !a.digest)) return { state: 'incomplete' }
    const canonical = JSON.stringify({ version: 1, draftId: draft.id, revision, text: { title: draft.content.title, description: draft.content.description },
      media: assets.map((a, i) => ({ slot: i, caption: draft.content.captions[i], objectName: a.object_name, generation: a.generation, digest: a.digest })) })
    if (canonical !== frozen.value.canonical) return { state: 'incomplete' }
    if ((await client.query('SELECT 1 FROM registered_submissions WHERE draft_id=$1 AND draft_revision=$2', [draft.id, revision])).rowCount) throw new Error('Draft revision already submitted')
    let userId = (await client.query<{ user_id: string }>('SELECT user_id FROM identities WHERE provider=$1 AND subject=$2', [provider, identity.uid])).rows[0]?.user_id
    if (!userId) {
      userId = (await client.query<{ id: string }>('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
      await client.query('INSERT INTO identities(user_id,provider,subject) VALUES ($1,$2,$3)', [userId, provider, identity.uid])
    }
    const contactId = (await client.query<{ id: string }>('INSERT INTO contacts(normalized_email) VALUES ($1) RETURNING id', [email])).rows[0].id
    const ideaId = (await client.query<{ id: string }>(`INSERT INTO ideas(owner_id,author_contact_id,location)
      VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography) RETURNING id`, [userId, contactId, longitude, latitude])).rows[0].id
    const content = JSON.stringify({ title: draft.content.title, description: draft.content.description, frozenManifest: JSON.parse(canonical) })
    const revisionId = (await client.query<{ id: string }>('INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,$2) RETURNING id', [ideaId, content])).rows[0].id
    const acceptedAt = (await client.query<{ accepted_at: Date }>(`INSERT INTO registered_submissions
      (draft_id,draft_revision,provider,subject,submission_key,request_digest,idea_id,revision_id,terms_version,terms_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING accepted_at`, [draft.id, revision, provider, identity.uid, key, requestDigest, ideaId, revisionId, termsVersion, termsText])).rows[0].accepted_at
    if (!await current(context, identity)) throw new Error('Identity changed during submission')
    return { state: 'ok', value: { ideaId, revisionId, acceptedAt } }
  })
}
