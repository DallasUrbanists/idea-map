import { CRC32C, type Storage } from '@google-cloud/storage'
import { createHash } from 'node:crypto'
import { finished } from 'node:stream/promises'
import { exactGenerationFile } from './storage-generation.js'
import { verifyBackupBucket } from './backup-bucket.js'

const recordIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[48][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Target = { environment: 'dev' | 'prod', bucket: string, projectNumber: string }
function validTarget(target: Target): boolean {
  return typeof process.env.STORAGE_EMULATOR_HOST !== 'string' && ['dev', 'prod'].includes(target?.environment) &&
    typeof target?.bucket === 'string' && /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(target.bucket) &&
    typeof target?.projectNumber === 'string' && /^[1-9][0-9]{5,19}$/.test(target.projectNumber)
}

function remainingTime(deadline: number): number {
  const remaining = Math.ceil(deadline - performance.now())
  if (remaining < 1) throw new Error('Held material operation timed out')
  return remaining
}

async function verifiedBucket(storage: Storage, target: Target, timeoutMs: number) {
  const bucket = storage.bucket(target.bucket)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const [metadata] = await Promise.race([
      bucket.getMetadata(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Bucket verification timed out')), timeoutMs) }),
    ])
    verifyBackupBucket(metadata, target)
    if (typeof metadata.generation !== 'string' || !/^[1-9][0-9]*$/.test(metadata.generation) ||
        typeof metadata.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(metadata.metageneration)) {
      throw new Error('Held material bucket identity is ambiguous')
    }
    return { bucket, metadata }
  } finally { if (timer) clearTimeout(timer) }
}

function hasStoredChecksum(response: { toJSON: () => { headers: Record<string, string> } }): boolean {
  try {
    const headers = response.toJSON().headers
    return headers['x-goog-stored-content-encoding'] === 'identity' &&
      typeof headers['x-goog-hash'] === 'string' && /(?:^|,)\s*crc32c=[A-Za-z0-9+/]{6}==\s*(?:,|$)/.test(headers['x-goog-hash'])
  } catch { return false }
}

/**
 * Preserve one already-authorized, already-scoped piece of held material in
 * the existing private backup bucket with a requested temporary object hold.
 * The returned metadata confirms only the observed upload response. This unwired
 * primitive does not identify the scope, take source locks, authenticate a hold,
 * prove complete capture, manage release or expiry, or permit deletion of its
 * source or an archive.
 * Its caller must protect the returned reference and digest as private data.
 */
export async function writeUnverifiedHeldMaterial(storage: Storage, target: Target, artifactId: string,
  payload: Uint8Array, timeoutMs = 5000): Promise<{ generation: string, size: number, sha256: string, coverageVerified: false }> {
  if (!validTarget(target) || typeof artifactId !== 'string' || !recordIdPattern.test(artifactId) || artifactId[14] !== '4' ||
      !(payload instanceof Uint8Array) || payload.byteLength < 1 || payload.byteLength > 16 * 1024 * 1024 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Invalid held material')
  const destination = { environment: target.environment, bucket: target.bucket, projectNumber: target.projectNumber }
  const bytes = Buffer.from(payload)
  const checksum = new CRC32C()
  checksum.update(bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const deadline = performance.now() + timeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { bucket, metadata: initialBucket } = await verifiedBucket(storage, destination, remainingTime(deadline))
    const bucketIdentity = { generation: initialBucket.generation, metageneration: initialBucket.metageneration }
    const path = `idea-map-v2/${destination.environment}/held-material/${artifactId}.bin`
    const file = bucket.file(path)
    const remaining = remainingTime(deadline)
    const stream = file.createWriteStream({ resumable: false, validation: 'crc32c', timeout: remaining,
      preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store', temporaryHold: true } })
    const done = finished(stream)
    timer = setTimeout(() => stream.destroy(new Error('Held material write timed out')), remaining)
    stream.end(bytes)
    await done
    remainingTime(deadline)
    const saved = file.metadata
    if (saved?.name !== path || saved.bucket !== destination.bucket ||
        typeof saved.generation !== 'string' || !/^[1-9][0-9]{0,19}$/.test(saved.generation) ||
        typeof saved.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(saved.metageneration) ||
        saved.size !== String(bytes.length) || saved.crc32c !== checksum.toString() || saved.temporaryHold !== true) {
      throw new Error('Held material metadata is ambiguous')
    }
    if (timer) { clearTimeout(timer); timer = undefined }
    const { metadata: finalBucket } = await verifiedBucket(storage, destination, remainingTime(deadline))
    if (finalBucket.generation !== bucketIdentity.generation || finalBucket.metageneration !== bucketIdentity.metageneration) {
      throw new Error('Held material bucket changed')
    }
    remainingTime(deadline)
    return { generation: saved.generation, size: bytes.length, sha256, coverageVerified: false }
  } catch {
    // A failed response can still leave a private object at the provider.
    throw new Error('Held material write outcome is uncertain')
  } finally { if (timer) clearTimeout(timer) }
}

/** Read a known private artifact and observe its hold; this does not prove scope or coverage. */
export async function readUnverifiedHeldMaterial(storage: Storage, target: Target, artifactId: string,
  reference: { generation: string, size: number, sha256: string }, timeoutMs = 5000): Promise<Uint8Array> {
  if (!validTarget(target) || typeof artifactId !== 'string' || !recordIdPattern.test(artifactId) || artifactId[14] !== '4' ||
      !reference || typeof reference.generation !== 'string' || !/^[1-9][0-9]{0,19}$/.test(reference.generation) ||
      !Number.isSafeInteger(reference.size) || reference.size < 1 || reference.size > 16 * 1024 * 1024 ||
      typeof reference.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(reference.sha256) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Invalid held material reference')
  const expected = { generation: reference.generation, size: reference.size, sha256: reference.sha256 }
  const destination = { environment: target.environment, bucket: target.bucket, projectNumber: target.projectNumber }
  const deadline = performance.now() + timeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { metadata: initialBucket } = await verifiedBucket(storage, destination, remainingTime(deadline))
    const bucketIdentity = { generation: initialBucket.generation, metageneration: initialBucket.metageneration }
    const path = `idea-map-v2/${destination.environment}/held-material/${artifactId}.bin`
    const file = exactGenerationFile(storage, destination.bucket, path, expected.generation)
    const heldMetadata = async () => {
      let metadataTimer: ReturnType<typeof setTimeout> | undefined
      try {
        const remaining = remainingTime(deadline)
        const [metadata] = await Promise.race([
          file.getMetadata(),
          new Promise<never>((_, reject) => { metadataTimer = setTimeout(() => reject(new Error('Held metadata timed out')), remaining) }),
        ])
        if (metadata.name !== path || metadata.bucket !== destination.bucket || metadata.generation !== expected.generation ||
            metadata.size !== String(expected.size) || metadata.temporaryHold !== true ||
            typeof metadata.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(metadata.metageneration)) {
          throw new Error('Held metadata is ambiguous')
        }
        return metadata.metageneration
      } finally { if (metadataTimer) clearTimeout(metadataTimer) }
    }
    const metageneration = await heldMetadata()
    const stream = file.createReadStream({ validation: 'crc32c', decompress: false })
    let checksumAvailable = false
    stream.on('response', (response: { toJSON: () => { headers: Record<string, string> } }) => {
      checksumAvailable = hasStoredChecksum(response)
    })
    timer = setTimeout(() => stream.destroy(new Error('Held material read timed out')), remainingTime(deadline))
    const chunks: Buffer[] = []
    let size = 0
    const hash = createHash('sha256')
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > expected.size) throw new Error('Held material is too large')
      hash.update(bytes)
      chunks.push(bytes)
    }
    if (!checksumAvailable || size !== expected.size || hash.digest('hex') !== expected.sha256) {
      throw new Error('Held material differs')
    }
    if (timer) { clearTimeout(timer); timer = undefined }
    if (await heldMetadata() !== metageneration) throw new Error('Held metadata changed')
    const { metadata: finalBucket } = await verifiedBucket(storage, destination, remainingTime(deadline))
    if (finalBucket.generation !== bucketIdentity.generation || finalBucket.metageneration !== bucketIdentity.metageneration) {
      throw new Error('Held material bucket changed')
    }
    remainingTime(deadline)
    return Buffer.concat(chunks)
  } catch {
    throw new Error('Held material could not be verified')
  } finally { if (timer) clearTimeout(timer) }
}
