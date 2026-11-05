import { compareUnverifiedSequenceRollover, validatedRolloverDescriptor, type RolloverDescriptor } from './recovery-sequence-rollover.js'
import { readUnverifiedRecoverySequenceFrames, type RecoverySequenceTransport } from './recovery-sequence-storage.js'

/**
 * Read both supplied epochs by exact number under one deadline and compare
 * their checkpoint link. This does not find other epochs or authenticate the
 * source, fence, writers, or coverage; the returned records remain private.
 */
export async function readUnverifiedSequenceRollover(previousReader: RecoverySequenceTransport, previous: RolloverDescriptor,
  nextReader: RecoverySequenceTransport, next: RolloverDescriptor, timeoutMs = 120_000) {
  let old: RolloverDescriptor, successor: RolloverDescriptor
  try {
    old = validatedRolloverDescriptor(previous)
    successor = validatedRolloverDescriptor(next)
    if (old.environment !== successor.environment || old.projectNumber !== successor.projectNumber ||
        old.epochId === successor.epochId || old.secretId === successor.secretId ||
        !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid request')
  } catch { throw new Error('Invalid rollover request') }
  const deadline = performance.now() + timeoutMs
  const remaining = () => {
    const value = Math.ceil(deadline - performance.now())
    if (value < 1) throw new Error('Rollover read timed out')
    return Math.min(value, 120_000)
  }
  try {
    const previousSequence = await readUnverifiedRecoverySequenceFrames(previousReader, old, old.fenceVersion, old.fenceNonce, remaining())
    const nextSequence = await readUnverifiedRecoverySequenceFrames(nextReader, successor, successor.fenceVersion, successor.fenceNonce, remaining())
    const result = compareUnverifiedSequenceRollover(old, previousSequence.frames, successor, nextSequence.frames)
    if (performance.now() >= deadline) throw new Error('Rollover read timed out')
    return result
  } catch { throw new Error('Rollover sequence could not be verified') }
}
