import { CRC32C, type Storage } from '@google-cloud/storage'
import { compareUnverifiedRecoveryCheckpoint, summarizeUnverifiedRecovery } from './recovery-journal-plan.js'
import { listUnverifiedRecoveryJournal, readRecoveryJournalRecord } from './recovery-journal-storage.js'

type Target = { environment: 'dev' | 'prod', bucket: string, projectNumber: string }

/**
 * Read a stable, bounded journal inventory after writers are independently
 * fenced. Output contains private records and identifiers; stability does not
 * authenticate a checkpoint, detect an absent tail, or establish coverage.
 */
export async function prepareUnverifiedRecoveryInventory(storage: Storage, target: Target, timeoutMs = 120_000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid recovery inventory')
  const deadline = performance.now() + timeoutMs
  const remaining = (limit: number) => {
    const value = Math.ceil(deadline - performance.now())
    if (value < 1) throw new Error('Recovery inventory timed out')
    return Math.min(value, limit)
  }
  try {
    const before = await listUnverifiedRecoveryJournal(storage, target, remaining(30_000))
    const records: Uint8Array[] = new Array(before.references.length)
    let position = 0, totalBytes = 0, stopped = false
    const read = async () => {
      while (!stopped) {
        const index = position++
        const reference = before.references[index]
        if (!reference) return
        try {
          const record = await readRecoveryJournalRecord(storage, target, reference.recordId, reference.generation, remaining(5000))
          const checksum = new CRC32C()
          checksum.update(Buffer.from(record))
          if (!checksum.validate(reference.crc32c)) throw new Error('Recovery inventory checksum differs')
          totalBytes += record.byteLength
          if (totalBytes > 32 * 1024 * 1024) throw new Error('Recovery inventory is too large')
          records[index] = record
        } catch (error) { stopped = true; throw error }
      }
    }
    const results = await Promise.allSettled(Array.from({ length: Math.min(8, before.references.length) }, read))
    if (results.some(result => result.status === 'rejected')) throw new Error('Recovery inventory read failed')
    const after = await listUnverifiedRecoveryJournal(storage, target, remaining(30_000))
    const comparison = compareUnverifiedRecoveryCheckpoint(before.references, after.references)
    if (before.bucketGeneration !== after.bucketGeneration || before.bucketMetageneration !== after.bucketMetageneration ||
        comparison.missing.length || comparison.changed.length || comparison.additional.length) {
      throw new Error('Recovery inventory changed')
    }
    const summary = summarizeUnverifiedRecovery(records, target.environment)
    remaining(1)
    return { records, references: before.references, bucketGeneration: before.bucketGeneration,
      bucketMetageneration: before.bucketMetageneration, summary, coverageVerified: false as const }
  } catch {
    // Provider responses and journal bodies can contain private information.
    throw new Error('Recovery inventory unavailable')
  }
}
