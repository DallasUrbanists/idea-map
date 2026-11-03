import type { Storage } from '@google-cloud/storage'
import { finished } from 'node:stream/promises'

const recordIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Write a prevalidated private record once. This transport does not authorize
 * decisions, establish coverage, capture held evidence, or make a restore safe.
 * Callers must retain the same record ID and bytes after an uncertain outcome.
 */
export async function writeRecoveryJournalRecord(storage: Storage,
  target: { environment: 'dev' | 'prod', bucket: string }, recordId: string, payload: Uint8Array,
  timeoutMs = 5000): Promise<void> {
  if (typeof process.env.STORAGE_EMULATOR_HOST === 'string' || !['dev', 'prod'].includes(target?.environment) ||
      typeof target?.bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(target.bucket) ||
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
