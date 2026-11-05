import { compareUnverifiedSequenceChain, validatedRolloverDescriptor, type RolloverDescriptor } from './recovery-sequence-rollover.js'
import { readUnverifiedRecoverySequenceFrames, type RecoverySequenceTransport } from './recovery-sequence-storage.js'

export type SequenceReaderEpoch = { reader: RecoverySequenceTransport, descriptor: RolloverDescriptor }

/**
 * Read both supplied epochs by exact number under one deadline and compare
 * their checkpoint link. This does not find other epochs or authenticate the
 * source, fence, writers, or coverage; the returned records remain private.
 */
export async function readUnverifiedSequenceRollover(previousReader: RecoverySequenceTransport, previous: RolloverDescriptor,
  nextReader: RecoverySequenceTransport, next: RolloverDescriptor, timeoutMs = 120_000) {
  const { epochCount: _epochCount, ...result } = await readUnverifiedSequenceChain([
    { reader: previousReader, descriptor: previous }, { reader: nextReader, descriptor: next },
  ], timeoutMs)
  return result
}

/** Read a bounded supplied chain, without discovering or authenticating earlier epochs. */
export async function readUnverifiedSequenceChain(epochs: SequenceReaderEpoch[], timeoutMs = 120_000) {
  let selected: SequenceReaderEpoch[]
  try {
    if (!Array.isArray(epochs) || epochs.length < 2 || epochs.length > 8 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid request')
    const epochIds = new Set<string>(), secrets = new Set<string>()
    selected = epochs.map(epoch => {
      if (!epoch || !epoch.reader || typeof epoch.reader.request !== 'function') throw new Error('Invalid request')
      const descriptor = validatedRolloverDescriptor(epoch.descriptor)
      if (epochIds.has(descriptor.epochId) || secrets.has(descriptor.secretId)) throw new Error('Invalid request')
      epochIds.add(descriptor.epochId); secrets.add(descriptor.secretId)
      return { reader: epoch.reader, descriptor }
    })
    if (selected.some(epoch => epoch.descriptor.environment !== selected[0].descriptor.environment ||
        epoch.descriptor.projectNumber !== selected[0].descriptor.projectNumber)) throw new Error('Invalid request')
  } catch { throw new Error('Invalid rollover request') }
  const deadline = performance.now() + timeoutMs
  const remaining = () => {
    const value = Math.ceil(deadline - performance.now())
    if (value < 1) throw new Error('Rollover read timed out')
    return Math.min(value, 120_000)
  }
  try {
    let total = 0
    const frames = []
    for (const { reader, descriptor } of selected) {
      const sequence = await readUnverifiedRecoverySequenceFrames(reader, descriptor, descriptor.fenceVersion, descriptor.fenceNonce, remaining())
      total += sequence.frames.reduce((sum, frame) => sum + frame.payload.byteLength, 0)
      if (total > 64 * 1024 * 1024) throw new Error('Rollover chain is too large')
      frames.push({ descriptor, frames: sequence.frames })
    }
    const result = compareUnverifiedSequenceChain(frames)
    if (performance.now() >= deadline) throw new Error('Rollover read timed out')
    return result
  } catch { throw new Error('Rollover sequence could not be verified') }
}
