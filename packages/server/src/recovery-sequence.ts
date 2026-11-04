import { decodeRecoveryRecord, recoveryConfirmationRecordId } from './recovery-journal-record.js'
import { summarizeUnverifiedRecovery } from './recovery-journal-plan.js'

type Base = { environment: 'dev' | 'prod', epochId: string }
type Baseline = Base & { kind: 'baseline', checkpointDigest: string }
type Decision = Base & { kind: 'decision', recordId: string, data: string }
type Fence = Base & { kind: 'fence', nonce: string }
type Entry = Baseline | Decision | Fence
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const recordId = /^[0-9a-f]{8}-[0-9a-f]{4}-[48][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const digest = /^[0-9a-f]{64}$/
function keys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort(), wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

/** Encode private sequence metadata; this is not authorization or coverage evidence. */
export function encodeRecoverySequenceEntry(input: Entry): Uint8Array {
  if (!input || typeof input !== 'object' || !['dev', 'prod'].includes(input.environment) ||
      typeof input.epochId !== 'string' || !uuid4.test(input.epochId)) throw new Error('Invalid recovery sequence entry')
  const base = { version: 1, environment: input.environment, epochId: input.epochId }
  if (input.kind === 'baseline') {
    if (!keys(input, ['kind', 'environment', 'epochId', 'checkpointDigest']) ||
        typeof input.checkpointDigest !== 'string' || !digest.test(input.checkpointDigest)) throw new Error('Invalid recovery sequence entry')
    return Buffer.from(JSON.stringify({ ...base, kind: input.kind, checkpointDigest: input.checkpointDigest }))
  }
  if (input.kind === 'decision') {
    if (!keys(input, ['kind', 'environment', 'epochId', 'recordId', 'data']) ||
        typeof input.recordId !== 'string' || !recordId.test(input.recordId) || typeof input.data !== 'string' || input.data.length > 21_848) {
      throw new Error('Invalid recovery sequence entry')
    }
    const bytes = Buffer.from(input.data, 'base64')
    if (bytes.length < 1 || bytes.length > 16_384 || bytes.toString('base64') !== input.data) throw new Error('Invalid recovery sequence entry')
    const decision = decodeRecoveryRecord(bytes, input.environment)
    if ((decision.recordType === 'intent' && input.recordId[14] !== '4') ||
        (decision.recordType !== 'intent' && recoveryConfirmationRecordId(decision.operationId) !== input.recordId)) {
      throw new Error('Invalid recovery sequence entry')
    }
    return Buffer.from(JSON.stringify({ ...base, kind: input.kind, recordId: input.recordId, data: input.data }))
  }
  if (input.kind === 'fence') {
    if (!keys(input, ['kind', 'environment', 'epochId', 'nonce']) || typeof input.nonce !== 'string' || !uuid4.test(input.nonce)) {
      throw new Error('Invalid recovery sequence entry')
    }
    return Buffer.from(JSON.stringify({ ...base, kind: input.kind, nonce: input.nonce }))
  }
  throw new Error('Invalid recovery sequence entry')
}

export function decodeRecoverySequenceEntry(payload: Uint8Array, environment: 'dev' | 'prod', epochId: string): Entry {
  try {
    if (!(payload instanceof Uint8Array) || payload.byteLength < 1 || payload.byteLength > 24_576) throw new Error('Invalid')
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid')
    const value = raw as Entry & { version: number }
    if (value.version !== 1 || value.environment !== environment || value.epochId !== epochId) throw new Error('Invalid')
    const { version: _version, ...entry } = value
    const encoded = encodeRecoverySequenceEntry(entry as Entry)
    if (!Buffer.from(payload).equals(encoded)) throw new Error('Invalid')
    return entry as Entry
  } catch { throw new Error('Recovery sequence entry is invalid or incompatible') }
}

/**
 * Check supplied exact-numbered entries through a selected sentinel. The caller
 * must independently authenticate the source, baseline, fence, and all writers.
 * Matching numbers alone cannot establish completeness or permit reopening.
 */
export function compareUnverifiedRecoverySequence(frames: { version: string, payload: Uint8Array }[],
  environment: 'dev' | 'prod', epochId: string, fenceVersion: string, fenceNonce: string) {
  try {
    if (!Array.isArray(frames) || !['dev', 'prod'].includes(environment) || !uuid4.test(epochId) ||
        typeof fenceVersion !== 'string' || !/^[1-9][0-9]{0,4}$/.test(fenceVersion) || Number(fenceVersion) > 10_000 ||
        typeof fenceNonce !== 'string' || !uuid4.test(fenceNonce) || frames.length !== Number(fenceVersion)) throw new Error('Invalid')
    let baseline: string | undefined, baselineClosed = false, matchingFence = false
    const decisions = new Map<string, string>()
    let totalBytes = 0
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index]
      if (!frame || frame.version !== String(index + 1)) throw new Error('Invalid')
      const entry = decodeRecoverySequenceEntry(frame.payload, environment, epochId)
      if (entry.kind === 'baseline') {
        if (baselineClosed || (baseline !== undefined && baseline !== entry.checkpointDigest)) throw new Error('Invalid')
        baseline = entry.checkpointDigest
        continue
      }
      if (baseline === undefined) throw new Error('Invalid')
      baselineClosed = true
      if (entry.kind === 'decision') {
        if (matchingFence) throw new Error('Invalid')
        const previous = decisions.get(entry.recordId)
        if (previous !== undefined && previous !== entry.data) throw new Error('Invalid')
        if (previous === undefined) {
          totalBytes += Buffer.from(entry.data, 'base64').length
          if (totalBytes > 32 * 1024 * 1024) throw new Error('Invalid')
          decisions.set(entry.recordId, entry.data)
        }
      } else if (entry.nonce === fenceNonce) matchingFence = true
      else if (matchingFence) throw new Error('Invalid')
      if (index === frames.length - 1 && (entry.kind !== 'fence' || entry.nonce !== fenceNonce)) throw new Error('Invalid')
    }
    if (baseline === undefined || !matchingFence) throw new Error('Invalid')
    const records = [...decisions.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([id, data]) => ({ recordId: id, payload: Buffer.from(data, 'base64') }))
    const summary = summarizeUnverifiedRecovery(records.map(record => record.payload), environment)
    return { checkpointDigest: baseline, records, summary, coverageVerified: false as const }
  } catch { throw new Error('Recovery sequence could not be verified') }
}
