import { createHash } from 'node:crypto'
import { decodeRecoveryRecord } from './recovery-journal-record.js'
import { summarizeUnverifiedRecovery } from './recovery-journal-plan.js'
import { compareUnverifiedRecoverySequence } from './recovery-sequence.js'

export type RolloverDescriptor = { environment: 'dev' | 'prod', epochId: string, projectNumber: string, secretId: string,
  fenceVersion: string, fenceNonce: string }
type Frame = { version: string, payload: Uint8Array }
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Copy and validate the exact source and fence before contacting a provider. */
export function validatedRolloverDescriptor(descriptor: RolloverDescriptor): RolloverDescriptor {
  if (!descriptor || !['dev', 'prod'].includes(descriptor.environment) ||
      typeof descriptor.epochId !== 'string' || !uuid4.test(descriptor.epochId) ||
      typeof descriptor.projectNumber !== 'string' || !/^[1-9][0-9]{5,19}$/.test(descriptor.projectNumber) ||
      typeof descriptor.secretId !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(descriptor.secretId) ||
      typeof descriptor.fenceNonce !== 'string' || !uuid4.test(descriptor.fenceNonce) ||
      typeof descriptor.fenceVersion !== 'string' || !/^[1-9][0-9]{0,4}$/.test(descriptor.fenceVersion) ||
      Number(descriptor.fenceVersion) > 10_000) {
    throw new Error('Invalid rollover sequence')
  }
  return { environment: descriptor.environment, epochId: descriptor.epochId, projectNumber: descriptor.projectNumber,
    secretId: descriptor.secretId, fenceVersion: descriptor.fenceVersion, fenceNonce: descriptor.fenceNonce }
}

function snapshot(descriptor: RolloverDescriptor, frames: Frame[]) {
  const target = validatedRolloverDescriptor(descriptor)
  if (!Array.isArray(frames) || frames.length !== Number(target.fenceVersion)) throw new Error('Invalid rollover sequence')
  let total = 0
  const copied = frames.map(frame => {
    if (!frame || typeof frame.version !== 'string' || !(frame.payload instanceof Uint8Array) || frame.payload.byteLength > 24_576) {
      throw new Error('Invalid rollover sequence')
    }
    total += frame.payload.byteLength
    if (total > 32 * 1024 * 1024) throw new Error('Rollover sequence is too large')
    return { version: frame.version, payload: Buffer.from(frame.payload) }
  })
  const compared = compareUnverifiedRecoverySequence(copied, target.environment, target.epochId, target.fenceVersion, target.fenceNonce)
  return { target, copied, compared }
}

function digestSequence(sequence: ReturnType<typeof snapshot>) {
  const hash = createHash('sha256').update('idea-map-recovery-rollover-v1\0').update(JSON.stringify(sequence.target))
  for (const frame of sequence.copied) {
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(frame.payload.byteLength)
    hash.update(length).update(frame.payload)
  }
  return hash.digest('hex')
}

/**
 * Bind one supplied numbered sequence to a proposed next-epoch checkpoint.
 * This does not authenticate the source, establish a writer fence, prove the
 * sequence complete, or authorize destruction of any earlier versions.
 */
export function unverifiedRolloverCheckpoint(descriptor: RolloverDescriptor, frames: Frame[]) {
  try {
    return { checkpointDigest: digestSequence(snapshot(descriptor, frames)), coverageVerified: false as const }
  } catch { throw new Error('Rollover checkpoint could not be verified') }
}

/**
 * Check two supplied epochs and their checkpoint link without asserting that
 * every writer or version was covered. Earlier epochs are not included in the
 * returned records, which remain private.
 */
export function compareUnverifiedSequenceRollover(previous: RolloverDescriptor, previousFrames: Frame[],
  next: RolloverDescriptor, nextFrames: Frame[]) {
  const { epochCount: _epochCount, ...result } = compareUnverifiedSequenceChain([
    { descriptor: previous, frames: previousFrames }, { descriptor: next, frames: nextFrames },
  ])
  return result
}

/** Compare a bounded supplied chain; its first baseline and external coverage remain unverified. */
export function compareUnverifiedSequenceChain(epochs: { descriptor: RolloverDescriptor, frames: Frame[] }[]) {
  try {
    if (!Array.isArray(epochs) || epochs.length < 2 || epochs.length > 8) throw new Error('Invalid rollover')
    let totalBytes = 0
    for (const epoch of epochs) {
      if (!epoch || !Array.isArray(epoch.frames) || epoch.frames.length < 1 || epoch.frames.length > 10_000) throw new Error('Invalid rollover')
      for (const frame of epoch.frames) {
        if (!frame || !(frame.payload instanceof Uint8Array)) throw new Error('Invalid rollover')
        totalBytes += frame.payload.byteLength
        if (totalBytes > 64 * 1024 * 1024) throw new Error('Rollover chain is too large')
      }
    }
    const sequences = epochs.map(epoch => snapshot(epoch.descriptor, epoch.frames))
    const first = sequences[0]
    const epochsSeen = new Set<string>(), secretsSeen = new Set<string>()
    for (let index = 0; index < sequences.length; index++) {
      const sequence = sequences[index]
      if (sequence.target.environment !== first.target.environment || sequence.target.projectNumber !== first.target.projectNumber ||
          epochsSeen.has(sequence.target.epochId) || secretsSeen.has(sequence.target.secretId) ||
          (index > 0 && sequence.compared.checkpointDigest !== digestSequence(sequences[index - 1]))) throw new Error('Invalid rollover')
      epochsSeen.add(sequence.target.epochId); secretsSeen.add(sequence.target.secretId)
    }
    const earlierIntents = new Set<string>(), earlierConfirmations = new Set<string>()
    const records = new Map<string, Uint8Array>()
    for (const sequence of sequences) {
      const currentIntents = new Set<string>(), currentConfirmations = new Set<string>()
      for (const record of sequence.compared.records) {
        const decision = decodeRecoveryRecord(record.payload, first.target.environment)
        if (decision.recordType === 'intent') currentIntents.add(decision.operationId)
        else currentConfirmations.add(decision.operationId)
        const prior = records.get(record.recordId)
        if (prior && !Buffer.from(prior).equals(record.payload)) throw new Error('Conflicting rollover record')
        if (!prior) records.set(record.recordId, Buffer.from(record.payload))
      }
      for (const operationId of currentIntents) {
        if (earlierConfirmations.has(operationId) && !earlierIntents.has(operationId)) throw new Error('Confirmation precedes intent')
        earlierIntents.add(operationId)
      }
      for (const operationId of currentConfirmations) earlierConfirmations.add(operationId)
    }
    const merged = [...records.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([recordId, payload]) => ({ recordId, payload }))
    const summary = summarizeUnverifiedRecovery(merged.map(record => record.payload), first.target.environment)
    return { epochCount: sequences.length, records: merged, summary, earlierEpochsIncluded: false as const, coverageVerified: false as const }
  } catch { throw new Error('Rollover sequence could not be verified') }
}
