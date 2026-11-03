import { createHash, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { runtimeDatabasePool } from './runtime-database.js'
import { verifyRegisteredSession, type RegisteredSessionVerifier } from './moderator-authorization.js'

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
    await client.query(`INSERT INTO registered_drafts(provider,subject,creation_key,creation_digest,content,expected_media)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (provider,subject,creation_key) DO NOTHING`,
    [`firebase:${context.projectId}`, identity.uid, creationKey, creationDigest, JSON.stringify(snapshot), snapshot.captions.length])
    const row = await client.query<{ id: string, revision: number, creation_digest: string }>(
      'SELECT id,revision,creation_digest FROM registered_drafts WHERE provider=$1 AND subject=$2 AND creation_key=$3 FOR UPDATE', [`firebase:${context.projectId}`, identity.uid, creationKey])
    if (row.rows[0].creation_digest !== creationDigest) throw new Error('Draft creation identity conflicts with existing input')
    if (!await current(context, identity)) throw new Error('Identity changed during draft operation')
    return { state: 'ok', value: { id: row.rows[0].id, revision: row.rows[0].revision } }
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
  if (observed.frozen_manifest !== null) return { state: 'ok', value: { canonical: observed.frozen_manifest as string } }
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
    if (draft.frozen_manifest !== null) return { state: 'ok', value: { canonical: draft.frozen_manifest as string } }
    const locked = await client.query<AssetRow>('SELECT * FROM registered_draft_media WHERE draft_id=$1 AND revision=$2 ORDER BY slot FOR UPDATE', [id, revision])
    if (locked.rows.length !== draft.expected_media || locked.rows.length !== assets.length || locked.rows.some((asset, i) => {
      const prior = assets[i]
      return asset.slot !== i || asset.id !== prior.id || asset.object_name !== prior.object_name || asset.generation !== prior.generation || asset.digest !== prior.digest || !asset.generation || !asset.digest
    })) return { state: 'incomplete' }
    const content = draft.content
    const canonical = JSON.stringify({ version: 1, draftId: id, revision, text: { title: content.title, description: content.description },
      media: locked.rows.map((asset, i) => ({ slot: i, caption: content.captions[i], objectName: asset.object_name, generation: asset.generation, digest: asset.digest })) })
    await client.query('UPDATE registered_drafts SET frozen_manifest=$2 WHERE id=$1', [id, canonical])
    if (!await current(context, identity)) throw new Error('Identity changed during draft operation')
    return { state: 'ok', value: { canonical } }
  })
}
