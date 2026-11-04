import type { Storage } from '@google-cloud/storage'
import { decodeRecoveryRecord } from './recovery-journal-record.js'
import { summarizeUnverifiedRecovery } from './recovery-journal-plan.js'
import { matchUnverifiedHeldManifest } from './recovery-held-manifest.js'
import { readUnverifiedHeldMaterial } from './recovery-journal-storage.js'

type Target = { environment: 'dev' | 'prod', bucket: string, projectNumber: string }

/**
 * Check the exact generations selected by one hold manifest after independently
 * fencing writers. A successful read does not authenticate the hold or scope,
 * prove a complete journal, protect future retention, or authorize deletion.
 */
export async function verifyUnverifiedHeldCapture(storage: Storage, target: Target,
  intentBytes: Uint8Array, confirmationBytes: Uint8Array, timeoutMs = 120_000) {
  if (!target || !['dev', 'prod'].includes(target.environment) ||
      !(intentBytes instanceof Uint8Array) || intentBytes.byteLength < 1 || intentBytes.byteLength > 16_384 ||
      !(confirmationBytes instanceof Uint8Array) || confirmationBytes.byteLength < 1 || confirmationBytes.byteLength > 16_384 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid held capture')
  const destination = { environment: target.environment, bucket: target.bucket, projectNumber: target.projectNumber }
  const intent = Buffer.from(intentBytes), confirmation = Buffer.from(confirmationBytes)
  const deadline = performance.now() + timeoutMs
  const remaining = () => {
    const milliseconds = Math.ceil(deadline - performance.now())
    if (milliseconds < 1) throw new Error('Held capture verification timed out')
    return Math.min(milliseconds, 5000)
  }
  try {
    const record = decodeRecoveryRecord(confirmation, destination.environment)
    const decision = decodeRecoveryRecord(intent, destination.environment)
    if (record.recordType !== 'hold_commit_confirmation' || record.version !== 3 || decision.recordType !== 'intent' ||
        decision.decision.kind !== 'hold_placement' || decision.operationId !== record.operationId) throw new Error('Held manifest is missing')
    summarizeUnverifiedRecovery([intent, confirmation], destination.environment)
    const reference = record.heldManifest
    const bytes = await readUnverifiedHeldMaterial(storage, destination, reference.artifactId, reference, remaining())
    const { manifest } = matchUnverifiedHeldManifest(intent, confirmation, bytes, destination.environment)
    const totalBytes = manifest.entries.reduce((total, entry) => total + entry.size, 0)
    if (totalBytes > 128 * 1024 * 1024) throw new Error('Held capture is too large')
    let next = 0, stopped = false
    const check = async () => {
      while (!stopped) {
        const entry = manifest.entries[next++]
        if (!entry) return
        try { await readUnverifiedHeldMaterial(storage, destination, entry.artifactId, entry, remaining()) }
        catch (error) { stopped = true; throw error }
      }
    }
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, manifest.entries.length) }, check))
    if (results.some(result => result.status === 'rejected')) throw new Error('Held capture is unavailable')
    remaining()
    return { checkedArtifacts: manifest.entries.length, totalBytes, coverageVerified: false as const }
  } catch {
    // Artifact references, content, and provider responses are private.
    throw new Error('Held capture could not be verified')
  }
}
