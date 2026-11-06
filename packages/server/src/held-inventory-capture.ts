import { CRC32C, type Storage } from '@google-cloud/storage'
import { createHash } from 'node:crypto'
import { addAbortSignal } from 'node:stream'
import { withLegalAuthority } from './legal-holds.js'
import type { RegisteredSessionVerifier } from './moderator-authorization.js'
import { encodeUnverifiedHeldManifest, snapshotUnverifiedHeldSources, type HeldSource } from './recovery-held-manifest.js'
import { readUnverifiedHeldMaterial, writeUnverifiedHeldMaterial } from './recovery-held-storage.js'
import { exactGenerationFile } from './storage-generation.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const maxArtifactBytes = 16 * 1024 * 1024
const maxCaptureBytes = 96 * 1024 * 1024
type Destination = Parameters<typeof writeUnverifiedHeldMaterial>[1]
type SourceRow = {
  idea_id: string
  source: HeldSource
  body: Buffer | null
  object_name: string | null
  object_digest: string | null
  object_store: 'upload' | 'preview' | null
}
type Selection = { source: HeldSource, artifactId: string }
type CaptureRequest = { holdId: string, operationId: string, manifestArtifactId: string, selections: Selection[] }

function sourceKey(source: HeldSource) {
  return JSON.stringify([source.kind, source.sourceId, source.sourceGeneration, source.kind === 'related_record' ? source.sourceType : null])
}

async function readOriginalMedia(storage: Storage, row: SourceRow, buckets: { upload: string, preview: string },
  limit: number, timeout: number): Promise<Buffer> {
  if (row.source.kind !== 'media' || !row.object_name || !row.object_store || !buckets[row.object_store]) {
    throw new Error('Held media source unavailable')
  }
  const bucket = buckets[row.object_store]
  const file = exactGenerationFile(storage, bucket, row.object_name, row.source.sourceGeneration)
  const signal = AbortSignal.timeout(timeout)
  let onAbort: () => void = () => {}
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Held media read timed out'))
      signal.addEventListener('abort', onAbort, { once: true })
    })
    const [metadata] = await Promise.race([file.getMetadata(), aborted])
    const bytes = Number(metadata.size)
    if (metadata.generation !== row.source.sourceGeneration || metadata.bucket !== bucket || metadata.name !== row.object_name ||
        !Number.isSafeInteger(bytes) || bytes < 1 || bytes > limit || typeof metadata.crc32c !== 'string' ||
        !/^[A-Za-z0-9+/]{5}[AQgw]==$/.test(metadata.crc32c)) throw new Error('Held media metadata differs')
    const stream = addAbortSignal(signal, file.createReadStream({ validation: 'crc32c', decompress: false }))
    const chunks: Buffer[] = []
    let read = 0
    for await (const chunk of stream) {
      const part = Buffer.from(chunk)
      read += part.length
      if (read > bytes) throw new Error('Held media is oversized')
      chunks.push(part)
    }
    const body = Buffer.concat(chunks)
    const checksum = new CRC32C()
    checksum.update(body)
    if (read !== bytes || checksum.toString() !== metadata.crc32c ||
        (row.object_digest && createHash('sha256').update(body).digest('hex') !== row.object_digest)) {
      throw new Error('Held media content differs')
    }
    return body
  } finally { signal.removeEventListener('abort', onAbort) }
}

/** List supported primary references under the active hold for authorized scope review. */
export async function listAuthorizedHeldSourceCandidates(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, holdId: string) {
  if (typeof holdId !== 'string' || !uuid.test(holdId)) throw new Error('Invalid hold for source inventory')
  return withLegalAuthority(databaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    const { rows } = await client.query<Pick<SourceRow, 'idea_id' | 'source'>>(
      'SELECT idea_id, source FROM public.read_held_source_selection($1,$2,$3,NULL)', [provider, subject, holdId],
    )
    const ideaId = rows[0]?.idea_id
    if (!ideaId || !uuid.test(ideaId) || rows.some(row => row.idea_id !== ideaId)) {
      throw new Error('Held source inventory is unavailable')
    }
    return { holdId, ideaId, sources: snapshotUnverifiedHeldSources(rows.map(row => row.source)) }
  })
}

async function loadHeldSources(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  holdId: string, sources: HeldSource[]) {
  const access = await withLegalAuthority(databaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    const { rows } = await client.query<SourceRow>(
      'SELECT * FROM public.read_held_source_selection($1,$2,$3,$4::jsonb)',
      [provider, subject, holdId, JSON.stringify(sources)],
    )
    return rows
  })
  if (access.state !== 'authorized') return access
  const rows = new Map(access.value.map(row => [sourceKey(row.source), row]))
  const ideaId = access.value[0]?.idea_id
  if (!ideaId || access.value.length !== sources.length || rows.size !== sources.length ||
      !sources.every(source => rows.has(sourceKey(source))) || access.value.some(row => row.idea_id !== ideaId)) {
    throw new Error('Held source selection is incomplete')
  }
  return { state: 'authorized' as const, value: { ideaId, rows } }
}

type CapturedManifest = ReturnType<typeof import('./recovery-held-manifest.js').decodeUnverifiedHeldManifest>

/** Recheck every approved source's bytes against the manifest before journaling the review. */
export async function verifyHeldInventorySources(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, storage: Storage, buckets: { upload: string, preview: string },
  manifest: CapturedManifest, remaining: () => number) {
  const sources: HeldSource[] = manifest.entries.map(entry => entry.kind === 'related_record'
    ? { kind: entry.kind, sourceType: entry.sourceType, sourceId: entry.sourceId, sourceGeneration: null }
    : entry.kind === 'media'
      ? { kind: entry.kind, sourceId: entry.sourceId, sourceGeneration: entry.sourceGeneration }
      : { kind: entry.kind, sourceId: entry.sourceId, sourceGeneration: null })
  const access = await loadHeldSources(databaseUrl, projectId, cookie, verifier, manifest.holdId, sources)
  if (access.state !== 'authorized') return access
  if (access.value.ideaId !== manifest.ideaId) throw new Error('Held source selection differs')
  for (const entry of manifest.entries) {
    const row = access.value.rows.get(sourceKey(entry))!
    const body = row.body ?? await readOriginalMedia(storage, row, buckets, entry.size, remaining())
    if (body.length !== entry.size || createHash('sha256').update(body).digest('hex') !== entry.sha256) {
      throw new Error('Held source changed after capture')
    }
  }
  remaining()
  return { state: 'authorized' as const, value: true as const }
}

/**
 * Capture explicit sources for an active hold from the authoritative database
 * and exact media generations. Record the candidate IDs privately before calling.
 * Completeness and any scope change still require separate case review.
 */
export async function captureAuthorizedHeldInventory(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, storage: { source: Storage, held: Storage },
  target: Destination, sourceBuckets: { upload: string, preview: string }, request: CaptureRequest) {
  const { holdId, operationId, manifestArtifactId } = request
  if (!uuid.test(holdId) || !uuid4.test(operationId) || !uuid4.test(manifestArtifactId) ||
      !Array.isArray(request.selections) || request.selections.length < 1 || request.selections.length > 100) {
    throw new Error('Invalid held inventory capture')
  }
  const sources = snapshotUnverifiedHeldSources(request.selections.map(selection => selection.source))
  const artifactIds = request.selections.map(selection => selection.artifactId)
  if (artifactIds.some(id => !uuid4.test(id)) || new Set([manifestArtifactId, ...artifactIds]).size !== artifactIds.length + 1) {
    throw new Error('Invalid held inventory artifacts')
  }
  const destination = { ...target }, buckets = { ...sourceBuckets }
  const access = await loadHeldSources(databaseUrl, projectId, cookie, verifier, holdId, sources)
  if (access.state !== 'authorized') return access
  const { ideaId, rows } = access.value
  const deadline = performance.now() + 120_000
  const remaining = () => {
    const ms = Math.ceil(deadline - performance.now())
    if (ms < 1) throw new Error('Held inventory capture timed out')
    return Math.min(ms, 5000)
  }
  let totalBytes = 0
  try {
    const entries = []
    for (const [index, source] of sources.entries()) {
      const row = rows.get(sourceKey(source))!
      const limit = Math.min(maxArtifactBytes, maxCaptureBytes - totalBytes)
      const body = row.body ?? await readOriginalMedia(storage.source, row, buckets, limit, remaining())
      if (!body.length || body.length > limit) throw new Error('Held inventory is oversized')
      totalBytes += body.length
      const artifactId = artifactIds[index]!
      const { generation, size, sha256 } = await writeUnverifiedHeldMaterial(storage.held, destination, artifactId, body, remaining())
      const reference = { artifactId, generation, size, sha256 }
      await readUnverifiedHeldMaterial(storage.held, destination, artifactId, reference, remaining())
      entries.push({ ...source, ...reference })
    }
    const manifest = encodeUnverifiedHeldManifest({ environment: destination.environment, operationId, ideaId, holdId, entries })
    if (totalBytes + manifest.byteLength > maxCaptureBytes) throw new Error('Held inventory is oversized')
    const { generation, size, sha256 } = await writeUnverifiedHeldMaterial(storage.held, destination, manifestArtifactId, manifest, remaining())
    const inventory = { artifactId: manifestArtifactId, generation, size, sha256 }
    await readUnverifiedHeldMaterial(storage.held, destination, manifestArtifactId, inventory, remaining())
    return { state: 'authorized' as const, value: { ideaId, holdId, operationId, inventory, capturedSources: entries.length } }
  } catch {
    // Preserve the original hold and the candidate artifact IDs for private reconciliation.
    throw new Error('Held inventory capture requires reconciliation')
  }
}
