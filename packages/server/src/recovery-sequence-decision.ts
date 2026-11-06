import { recoveryConfirmationRecordId } from './recovery-journal-record.js'
import { decodeRecoverySequenceEntry, encodeRecoverySequenceEntry } from './recovery-sequence.js'
import { appendAndVerifyRecoverySequenceVersion, readRecoverySequenceVersion, type RecoverySequenceTransport } from './recovery-sequence-storage.js'
import type { LegalAuthorityAccess } from './legal-holds.js'

export type JournalCheckpoint = Parameters<typeof readRecoverySequenceVersion>[1] & { checkpointDigest: string }
export type JournalTransports = { writer: RecoverySequenceTransport, reader: RecoverySequenceTransport }
export type JournalProgress = { intentVersion: number | null, confirmedAt: string | null, confirmationVersion: number | null }

export async function verifyJournalCheckpoint(reader: RecoverySequenceTransport, target: JournalCheckpoint) {
  const baselineBytes = await readRecoverySequenceVersion(reader, target, '1')
  const entry = decodeRecoverySequenceEntry(baselineBytes, target.environment, target.epochId)
  if (entry.kind !== 'baseline' || entry.checkpointDigest !== target.checkpointDigest) throw new Error('Journal baseline unavailable')
}

/** Persist the first exact readback for each phase, with stable bytes for retry. */
export async function recordVerifiedHoldDecision({ writer, reader }: JournalTransports, target: JournalCheckpoint,
  operationId: string, intentBytes: Uint8Array, initial: JournalProgress, makeConfirmation: (confirmedAt: string) => Uint8Array,
  advance: (intentVersion: number, confirmationVersion: number | null) => Promise<LegalAuthorityAccess<JournalProgress>>,
): Promise<LegalAuthorityAccess<true>> {
  const frame = (recordId: string, bytes: Uint8Array) => Buffer.from(encodeRecoverySequenceEntry({
    kind: 'decision', environment: target.environment, epochId: target.epochId,
    recordId, data: Buffer.from(bytes).toString('base64'),
  }))
  async function verify(bytes: Buffer, version: number) {
    const observed = await readRecoverySequenceVersion(reader, target, String(version))
    if (!bytes.equals(observed)) throw new Error('Hold journal differs')
  }
  async function append(bytes: Buffer) {
    return Number((await appendAndVerifyRecoverySequenceVersion(writer, reader, target, bytes)).version)
  }

  const intent = frame(operationId, intentBytes)
  let progress = initial
  if (progress.intentVersion === null) {
    const version = await append(intent)
    const checkpoint = await advance(version, null)
    if (checkpoint.state !== 'authorized') return checkpoint
    progress = checkpoint.value
    if (progress.intentVersion !== null && progress.intentVersion !== version) await verify(intent, progress.intentVersion)
  } else await verify(intent, progress.intentVersion)
  if (progress.intentVersion === null || !progress.confirmedAt) throw new Error('Hold intent unavailable')

  const confirmation = frame(recoveryConfirmationRecordId(operationId), makeConfirmation(progress.confirmedAt))
  if (progress.confirmationVersion === null) {
    const version = await append(confirmation)
    const checkpoint = await advance(progress.intentVersion, version)
    if (checkpoint.state !== 'authorized') return checkpoint
    const recordedVersion = checkpoint.value.confirmationVersion
    if (recordedVersion === null) throw new Error('Hold confirmation unavailable')
    if (recordedVersion !== version) await verify(confirmation, recordedVersion)
  } else await verify(confirmation, progress.confirmationVersion)

  return { state: 'authorized', value: true }
}
