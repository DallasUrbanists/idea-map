type Base = { environment: 'dev' | 'prod', epochId: string }
type Baseline = Base & { kind: 'baseline', checkpointDigest: string }
type RecordReference = Base & { kind: 'record', recordId: string, generation: string, sha256: string }
type Fence = Base & { kind: 'fence', nonce: string }
type Entry = Baseline | RecordReference | Fence
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const recordId = /^[0-9a-f]{8}-[0-9a-f]{4}-[48][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const generation = /^[1-9][0-9]{0,19}$/
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
  if (input.kind === 'record') {
    if (!keys(input, ['kind', 'environment', 'epochId', 'recordId', 'generation', 'sha256']) ||
        typeof input.recordId !== 'string' || !recordId.test(input.recordId) || typeof input.generation !== 'string' ||
        !generation.test(input.generation) || typeof input.sha256 !== 'string' || !digest.test(input.sha256)) throw new Error('Invalid recovery sequence entry')
    return Buffer.from(JSON.stringify({ ...base, kind: input.kind, recordId: input.recordId, generation: input.generation, sha256: input.sha256 }))
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
    if (!(payload instanceof Uint8Array) || payload.byteLength < 1 || payload.byteLength > 4096) throw new Error('Invalid')
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
    const references = new Map<string, { recordId: string, generation: string, sha256: string }>()
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
      if (entry.kind === 'record') {
        if (matchingFence) throw new Error('Invalid')
        const previous = references.get(entry.recordId)
        if (previous && (previous.generation !== entry.generation || previous.sha256 !== entry.sha256)) throw new Error('Invalid')
        references.set(entry.recordId, { recordId: entry.recordId, generation: entry.generation, sha256: entry.sha256 })
      } else if (entry.nonce === fenceNonce) matchingFence = true
      else if (matchingFence) throw new Error('Invalid')
      if (index === frames.length - 1 && (entry.kind !== 'fence' || entry.nonce !== fenceNonce)) throw new Error('Invalid')
    }
    if (baseline === undefined || !matchingFence) throw new Error('Invalid')
    return { checkpointDigest: baseline, references: [...references.values()].sort((a, b) => a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0),
      coverageVerified: false as const }
  } catch { throw new Error('Recovery sequence could not be verified') }
}
