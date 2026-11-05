import type { Storage } from '@google-cloud/storage'
import { decodeRecoveryRecord } from './recovery-journal-record.js'
import { summarizeUnverifiedRecovery } from './recovery-journal-plan.js'
import { matchUnverifiedHeldManifest } from './recovery-held-manifest.js'
import { readUnverifiedHeldMaterial } from './recovery-held-storage.js'
import { readUnverifiedRecoverySequence, type RecoverySequenceTransport } from './recovery-sequence-storage.js'
import { readUnverifiedSequenceRollover } from './recovery-sequence-rollover-storage.js'
import type { RolloverDescriptor } from './recovery-sequence-rollover.js'

type Target = { environment: 'dev' | 'prod', bucket: string, projectNumber: string }
type Inventory = { records: { payload: Uint8Array }[], summary: { reviewOperations: string[], unmatchedConfirmations: number } }

/**
 * Check the exact generations selected by one hold manifest after independently
 * fencing writers. A successful read does not authenticate the hold or scope,
 * prove a complete journal, protect future retention, or authorize deletion.
 */
export async function verifyUnverifiedHeldCapture(storage: Storage, target: Target,
  intentBytes: Uint8Array, confirmationBytes: Uint8Array, timeoutMs = 120_000, maxTotalBytes = 128 * 1024 * 1024) {
  if (!target || !['dev', 'prod'].includes(target.environment) ||
      !(intentBytes instanceof Uint8Array) || intentBytes.byteLength < 1 || intentBytes.byteLength > 16_384 ||
      !(confirmationBytes instanceof Uint8Array) || confirmationBytes.byteLength < 1 || confirmationBytes.byteLength > 16_384 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
      !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > 128 * 1024 * 1024) throw new Error('Invalid held capture')
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
    // The manifest is also downloaded from storage and must fit in the same
    // budget as the artifact bytes it describes.
    if (reference.size > maxTotalBytes) throw new Error('Held capture is too large')
    const bytes = await readUnverifiedHeldMaterial(storage, destination, reference.artifactId, reference, remaining())
    const { manifest } = matchUnverifiedHeldManifest(intent, confirmation, bytes, destination.environment)
    const totalBytes = manifest.entries.reduce((total, entry) => total + entry.size, reference.size)
    if (totalBytes > maxTotalBytes) throw new Error('Held capture is too large')
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

async function verifyInventoryHeldCaptures(inventory: Inventory, environment: 'dev' | 'prod', storage: Storage,
  destination: Target, remaining: () => number) {
  const intents = new Map<string, Uint8Array>(), confirmations = new Map<string, Uint8Array>()
  for (const { payload } of inventory.records) {
    const record = decodeRecoveryRecord(payload, environment)
    if (record.recordType === 'intent' && record.decision.kind === 'hold_placement') intents.set(record.operationId, payload)
    else if (record.recordType === 'hold_commit_confirmation' && record.version === 3) confirmations.set(record.operationId, payload)
  }
  if (intents.size > 100) throw new Error('Held capture inventory is too large')
  let checkedCaptures = 0, checkedArtifacts = 0, totalBytes = 0, incompletePlacements = 0
  for (const [operationId, intent] of intents) {
    const confirmation = confirmations.get(operationId)
    if (!confirmation) { incompletePlacements++; continue }
    const budget = Math.min(128 * 1024 * 1024, 512 * 1024 * 1024 - totalBytes)
    if (budget < 1) throw new Error('Held capture inventory is too large')
    const checked = await verifyUnverifiedHeldCapture(storage, destination, intent, confirmation, remaining(), budget)
    checkedCaptures++; checkedArtifacts += checked.checkedArtifacts; totalBytes += checked.totalBytes
  }
  remaining()
  return { checkedCaptures, checkedArtifacts, totalBytes, incompletePlacements,
    reviewOperations: inventory.summary.reviewOperations.length, unmatchedConfirmations: inventory.summary.unmatchedConfirmations,
    coverageVerified: false as const, authorityVerified: false as const }
}

/**
 * Check the selected captures named by a numbered sequence, while preserving
 * every unresolved hold for manual review. This does not authenticate the
 * sequence, authority or scope, nor establish complete held-material coverage.
 */
export async function verifySequenceHeldCaptures(reader: RecoverySequenceTransport,
  sequenceTarget: { environment: 'dev' | 'prod', epochId: string, projectNumber: string, secretId: string },
  fenceVersion: string, fenceNonce: string, storage: Storage, heldTarget: Target, timeoutMs = 120_000) {
  if (!sequenceTarget || !heldTarget || sequenceTarget.environment !== heldTarget.environment ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid held capture')
  const sequence = { ...sequenceTarget }, destination = { ...heldTarget }
  const deadline = performance.now() + timeoutMs
  const remaining = () => {
    const value = Math.ceil(deadline - performance.now())
    if (value < 1) throw new Error('Held capture verification timed out')
    return value
  }
  try {
    const inventory = await readUnverifiedRecoverySequence(reader, sequence, fenceVersion, fenceNonce, remaining())
    return await verifyInventoryHeldCaptures(inventory, sequence.environment, storage, destination, remaining)
  } catch { throw new Error('Held capture inventory could not be verified') }
}

/** Verify only captures named in two linked epochs; earlier history remains unverified. */
export async function verifyRolloverHeldCaptures(previousReader: RecoverySequenceTransport, previous: RolloverDescriptor,
  nextReader: RecoverySequenceTransport, next: RolloverDescriptor, storage: Storage, heldTarget: Target, timeoutMs = 120_000) {
  if (!previous || !next || !heldTarget || previous.environment !== heldTarget.environment ||
      next.environment !== heldTarget.environment || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Invalid held capture')
  }
  const old = { ...previous }, successor = { ...next }, destination = { ...heldTarget }
  const deadline = performance.now() + timeoutMs
  const remaining = () => {
    const value = Math.ceil(deadline - performance.now())
    if (value < 1) throw new Error('Held capture verification timed out')
    return value
  }
  try {
    const inventory = await readUnverifiedSequenceRollover(previousReader, old, nextReader, successor, remaining())
    const result = await verifyInventoryHeldCaptures(inventory, old.environment, storage, destination, remaining)
    return { ...result, earlierEpochsIncluded: false as const }
  } catch { throw new Error('Held capture inventory could not be verified') }
}
