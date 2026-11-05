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
  try {
    const old = snapshot(previous, previousFrames), successor = snapshot(next, nextFrames)
    if (old.target.environment !== successor.target.environment || old.target.projectNumber !== successor.target.projectNumber ||
        old.target.epochId === successor.target.epochId || old.target.secretId === successor.target.secretId) throw new Error('Invalid rollover')
    if (successor.compared.checkpointDigest !== digestSequence(old)) throw new Error('Invalid rollover')
    const oldIntents = new Set<string>(), oldConfirmations = new Set<string>(), nextIntents = new Set<string>()
    const records = new Map<string, Uint8Array>()
    for (const [index, sequence] of [old, successor].entries()) {
      for (const record of sequence.compared.records) {
        const decision = decodeRecoveryRecord(record.payload, old.target.environment)
        if (index === 0 && decision.recordType === 'intent') oldIntents.add(decision.operationId)
        if (index === 0 && decision.recordType !== 'intent') oldConfirmations.add(decision.operationId)
        if (index === 1 && decision.recordType === 'intent') nextIntents.add(decision.operationId)
        const prior = records.get(record.recordId)
        if (prior && !Buffer.from(prior).equals(record.payload)) throw new Error('Conflicting rollover record')
        if (!prior) records.set(record.recordId, Buffer.from(record.payload))
      }
    }
    for (const operationId of oldConfirmations) {
      if (!oldIntents.has(operationId) && nextIntents.has(operationId)) throw new Error('Confirmation precedes intent')
    }
    const merged = [...records.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([recordId, payload]) => ({ recordId, payload }))
    const summary = summarizeUnverifiedRecovery(merged.map(record => record.payload), old.target.environment)
    return { records: merged, summary, earlierEpochsIncluded: false as const, coverageVerified: false as const }
  } catch { throw new Error('Rollover sequence could not be verified') }
}
