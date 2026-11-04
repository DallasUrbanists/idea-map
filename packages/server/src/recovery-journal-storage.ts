import { CRC32C, type Storage } from '@google-cloud/storage'
import { finished } from 'node:stream/promises'
import { decodeRecoveryRecord, recoveryConfirmationRecordId } from './recovery-journal-record.js'
import { exactGenerationFile } from './storage-generation.js'
import { verifyBackupBucket } from './backup-bucket.js'

const recordIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[48][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Target = { environment: 'dev' | 'prod', bucket: string, projectNumber: string }
function validTarget(target: Target): boolean {
  return typeof process.env.STORAGE_EMULATOR_HOST !== 'string' && ['dev', 'prod'].includes(target?.environment) &&
    typeof target?.bucket === 'string' && /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(target.bucket) &&
    typeof target?.projectNumber === 'string' && /^[1-9][0-9]{5,19}$/.test(target.projectNumber)
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
    return bucket
  } finally { if (timer) clearTimeout(timer) }
}

function validateRecordName(recordId: string, payload: Uint8Array, environment: Target['environment']): void {
  const record = decodeRecoveryRecord(payload, environment)
  if (recordId[14] === '8' && (record.recordType === 'intent' || recoveryConfirmationRecordId(record.operationId) !== recordId)) {
    throw new Error('Journal record name is incompatible')
  }
}

/**
 * Write a prevalidated private record once. This transport does not authorize
 * decisions, establish coverage, capture held evidence, or make a restore safe.
 * Callers must retain the same record ID and bytes after an uncertain outcome.
 */
export async function writeRecoveryJournalRecord(storage: Storage,
  target: Target, recordId: string, payload: Uint8Array,
  timeoutMs = 5000): Promise<void> {
  if (!validTarget(target) ||
      typeof recordId !== 'string' || !recordIdPattern.test(recordId) || !(payload instanceof Uint8Array) || payload.byteLength < 1 || payload.byteLength > 16_384 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Invalid journal record')
  const bytes = Buffer.from(payload)
  try {
    validateRecordName(recordId, bytes, target.environment)
  } catch {
    throw new Error('Invalid journal record')
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const path = `idea-map-v2/${target.environment}/recovery-journal/${recordId}.json`
    const bucket = await verifiedBucket(storage, target, timeoutMs)
    const stream = bucket.file(path).createWriteStream({
      resumable: false, validation: 'crc32c', timeout: timeoutMs, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
    })
    const done = finished(stream)
    timer = setTimeout(() => stream.destroy(new Error('Journal write timed out')), timeoutMs)
    stream.end(bytes)
    await done
  } catch {
    // A failed or timed-out write may still have reached the provider. Do not
    // leak provider messages or infer that the object was not created.
    throw new Error('Journal write outcome is uncertain')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Read one identified generation; existence and validity do not establish inventory coverage. */
export async function readRecoveryJournalRecord(storage: Storage, target: Target, recordId: string,
  generation: string, timeoutMs = 5000): Promise<Uint8Array> {
  if (!validTarget(target) || typeof recordId !== 'string' || !recordIdPattern.test(recordId) ||
      typeof generation !== 'string' || !/^[1-9][0-9]*$/.test(generation) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Invalid journal record reference')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const path = `idea-map-v2/${target.environment}/recovery-journal/${recordId}.json`
    await verifiedBucket(storage, target, timeoutMs)
    const file = exactGenerationFile(storage, target.bucket, path, generation)
    const stream = file.createReadStream({ validation: 'crc32c', decompress: false })
    let checksumAvailable = false
    stream.on('response', (response: { toJSON: () => { headers: Record<string, string> } }) => {
      try {
        const headers = response.toJSON().headers
        // The SDK skips checksum validation when stored encoding is unknown.
        checksumAvailable = headers['x-goog-stored-content-encoding'] === 'identity' &&
          typeof headers['x-goog-hash'] === 'string' && /(?:^|,)\s*crc32c=[A-Za-z0-9+/]{6}==\s*(?:,|$)/.test(headers['x-goog-hash'])
      } catch { checksumAvailable = false }
    })
    timer = setTimeout(() => stream.destroy(new Error('Journal read timed out')), timeoutMs)
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > 16_384) throw new Error('Journal record is too large')
      chunks.push(bytes)
    }
    const payload = Buffer.concat(chunks)
    if (!checksumAvailable) throw new Error('Journal checksum unavailable')
    validateRecordName(recordId, payload, target.environment)
    return payload
  } catch {
    // Object names, provider errors, and record contents are private.
    throw new Error('Journal record could not be verified')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Discover live record references after writers have been independently fenced.
 * A listing cannot establish a missing tail, writer coverage, or past permanent
 * deletion. Metadata requests may finish after this function's deadline.
 */
export async function listUnverifiedRecoveryJournal(storage: Storage, target: Target):
Promise<{ references: { recordId: string, generation: string }[], coverageVerified: false, softDeletedChecked: true }> {
  if (!validTarget(target)) throw new Error('Invalid journal target')
  const prefix = `idea-map-v2/${target.environment}/recovery-journal/`
  const references: { recordId: string, generation: string }[] = []
  const names = new Set<string>()
  const deadline = Date.now() + 30_000
  try {
    const bucket = await verifiedBucket(storage, target, 5000)
    const listPage = async (mode: 'versions' | 'softDeleted', pageToken?: string) => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('Journal inventory timed out')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([
          bucket.getFiles({ prefix, ...(mode === 'versions' ? { versions: true } : { softDeleted: true }),
            autoPaginate: false, maxResults: 1000, ...(pageToken ? { pageToken } : {}) }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Journal inventory timed out')), Math.min(remaining, 5000)) }),
        ])
        if (Date.now() > deadline) throw new Error('Journal inventory timed out')
        return result
      } finally { if (timer) clearTimeout(timer) }
    }
    for (const mode of ['versions', 'softDeleted'] as const) {
      const tokens = new Set<string>()
      let pageToken: string | undefined
      let finished = false
      for (let page = 0; page < 100; page++) {
        const [files, next] = await listPage(mode, pageToken)
        if (mode === 'softDeleted' && files.length) throw new Error('Soft-deleted journal records require review')
        for (const file of files) {
          const value = file.metadata
          const name = value.name
          const recordId = typeof name === 'string' && name.startsWith(prefix) && name.endsWith('.json')
            ? name.slice(prefix.length, -5) : ''
          if (!recordIdPattern.test(recordId) || names.has(recordId) || value.bucket !== target.bucket || value.timeDeleted ||
              typeof value.generation !== 'string' || !/^[1-9][0-9]*$/.test(value.generation) ||
              typeof value.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(value.metageneration) ||
              typeof value.size !== 'string' || !/^[1-9][0-9]*$/.test(value.size) || Number(value.size) > 16_384 ||
              value.contentType !== 'application/json' || (value.contentEncoding && value.contentEncoding !== 'identity') ||
              typeof value.crc32c !== 'string' || !/^[A-Za-z0-9+/]{6}==$/.test(value.crc32c)) throw new Error('Journal inventory is ambiguous')
          names.add(recordId)
          references.push({ recordId, generation: value.generation })
          if (references.length > 10_000) throw new Error('Journal inventory is too large')
        }
        if (!next) { finished = true; break }
        if (typeof next.pageToken !== 'string' || !next.pageToken || tokens.has(next.pageToken)) throw new Error('Journal inventory pagination is ambiguous')
        tokens.add(next.pageToken)
        pageToken = next.pageToken
      }
      if (!finished) throw new Error('Journal inventory has too many pages')
    }
    return { references, coverageVerified: false, softDeletedChecked: true }
  } catch {
    throw new Error('Journal inventory could not be verified')
  }
}

/**
 * Compare a live generation with saved intent bytes; this never establishes
 * coverage or reopens access. The metadata deadline bounds this call, but does
 * not cancel the SDK request, which may finish after the caller receives an error.
 */
export async function compareCurrentRecoveryJournalRecord(storage: Storage, target: Target, recordId: string,
  expected: Uint8Array, timeoutMs = 5000): Promise<{ generation: string, coverageVerified: false }> {
  if (!validTarget(target) || typeof recordId !== 'string' || !recordIdPattern.test(recordId) ||
      !(expected instanceof Uint8Array) || expected.byteLength < 1 || expected.byteLength > 16_384 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Invalid journal record reference')
  const bytes = Buffer.from(expected)
  try {
    decodeRecoveryRecord(bytes, target.environment)
    const path = `idea-map-v2/${target.environment}/recovery-journal/${recordId}.json`
    const bucket = await verifiedBucket(storage, target, timeoutMs)
    const file = bucket.file(path)
    const metadata = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const [value] = await Promise.race([
          file.getMetadata(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Metadata read timed out')), timeoutMs) }),
        ])
        if (value.bucket !== target.bucket || value.name !== path || typeof value.generation !== 'string' ||
            !/^[1-9][0-9]*$/.test(value.generation) || typeof value.metageneration !== 'string' ||
            !/^[1-9][0-9]*$/.test(value.metageneration) || value.timeDeleted || value.size !== String(bytes.length) ||
            value.contentType !== 'application/json' || (value.contentEncoding && value.contentEncoding !== 'identity') ||
            typeof value.crc32c !== 'string' || !/^[A-Za-z0-9+/]{6}==$/.test(value.crc32c)) throw new Error('Invalid metadata')
        return { generation: value.generation, metageneration: value.metageneration, crc32c: value.crc32c }
      } finally { if (timer) clearTimeout(timer) }
    }
    const first = await metadata()
    const checksum = new CRC32C()
    checksum.update(bytes)
    if (!checksum.validate(first.crc32c)) throw new Error('Journal checksum differs')
    const observed = await readRecoveryJournalRecord(storage, target, recordId, first.generation, timeoutMs)
    if (!Buffer.from(observed).equals(bytes)) throw new Error('Journal record differs')
    const last = await metadata()
    if (last.generation !== first.generation || last.metageneration !== first.metageneration ||
        last.crc32c !== first.crc32c) throw new Error('Journal generation changed')
    return { generation: first.generation, coverageVerified: false }
  } catch {
    // A comparison cannot prove authorization, completeness, or future availability.
    throw new Error('Journal record could not be verified')
  }
}
