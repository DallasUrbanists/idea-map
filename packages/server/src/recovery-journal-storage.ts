import type { Storage } from '@google-cloud/storage'
import { finished } from 'node:stream/promises'
import { decodeRecoveryRecord } from './recovery-journal-record.js'
import { exactGenerationFile } from './storage-generation.js'

const recordIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Target = { environment: 'dev' | 'prod', bucket: string }
function validTarget(target: Target): boolean {
  return typeof process.env.STORAGE_EMULATOR_HOST !== 'string' && ['dev', 'prod'].includes(target?.environment) &&
    typeof target?.bucket === 'string' && /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(target.bucket)
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
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid record body')
  } catch {
    throw new Error('Invalid journal record')
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const path = `idea-map-v2/${target.environment}/recovery-journal/${recordId}.json`
    const stream = storage.bucket(target.bucket).file(path).createWriteStream({
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
    decodeRecoveryRecord(payload, target.environment)
    return payload
  } catch {
    // Object names, provider errors, and record contents are private.
    throw new Error('Journal record could not be verified')
  } finally {
    if (timer) clearTimeout(timer)
  }
}
