import { createHash } from 'node:crypto'
import { decodeRecoveryRecord, type HeldArtifactReference } from './recovery-journal-record.js'
import { summarizeUnverifiedRecovery } from './recovery-journal-plan.js'

export type HeldSource =
  | { kind: 'revision', sourceId: string, sourceGeneration: null }
  | { kind: 'media', sourceId: string, sourceGeneration: string }
  | { kind: 'related_record', sourceType: string, sourceId: string, sourceGeneration: null }
type Entry = HeldArtifactReference & HeldSource
type Manifest = { environment: 'dev' | 'prod', operationId: string, ideaId: string, holdId: string, entries: Entry[] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const generation = /^[1-9][0-9]{0,19}$/
const digest = /^[0-9a-f]{64}$/
const maxBytes = 16 * 1024 * 1024

function keys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort(), wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function readSource(value: HeldSource): HeldSource {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.sourceId !== 'string' || !uuid.test(value.sourceId)) {
    throw new Error('Invalid held source')
  }
  if (value.kind === 'revision' && value.sourceGeneration === null) {
    return { kind: value.kind, sourceId: value.sourceId, sourceGeneration: null }
  }
  if (value.kind === 'media' && typeof value.sourceGeneration === 'string' && generation.test(value.sourceGeneration)) {
    return { kind: value.kind, sourceId: value.sourceId, sourceGeneration: value.sourceGeneration }
  }
  if (value.kind === 'related_record' && value.sourceGeneration === null && typeof value.sourceType === 'string' &&
      /^[a-z][a-z0-9_]{0,62}$/.test(value.sourceType)) {
    return { kind: value.kind, sourceType: value.sourceType, sourceId: value.sourceId, sourceGeneration: null }
  }
  throw new Error('Invalid held source')
}

function sourceKey(source: HeldSource): string {
  return `${source.kind}:${source.kind === 'related_record' ? source.sourceType : ''}:${source.sourceId}:${source.sourceGeneration ?? ''}`
}

/** Encode only explicitly selected references; this does not establish legal scope. */
export function encodeUnverifiedHeldManifest(input: Manifest): Uint8Array {
  if (!input || typeof input !== 'object' || !keys(input, ['environment', 'operationId', 'ideaId', 'holdId', 'entries']) ||
      !['dev', 'prod'].includes(input.environment) || typeof input.operationId !== 'string' || !uuid4.test(input.operationId) ||
      typeof input.ideaId !== 'string' || !uuid.test(input.ideaId) || typeof input.holdId !== 'string' || !uuid.test(input.holdId) ||
      !Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 10_000) throw new Error('Invalid held manifest')
  const sources = new Set<string>(), artifacts = new Set<string>()
  const entries = input.entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !keys(entry, ['kind', ...(entry.kind === 'related_record' ? ['sourceType'] : []), 'sourceId', 'sourceGeneration', 'artifactId', 'generation', 'size', 'sha256']) ||
        typeof entry.artifactId !== 'string' || !uuid4.test(entry.artifactId) || typeof entry.generation !== 'string' || !generation.test(entry.generation) ||
        !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > maxBytes || typeof entry.sha256 !== 'string' || !digest.test(entry.sha256)) {
      throw new Error('Invalid held manifest')
    }
    let selected: HeldSource
    try { selected = readSource(entry) } catch { throw new Error('Invalid held manifest') }
    const source = sourceKey(selected)
    if (sources.has(source) || artifacts.has(entry.artifactId)) throw new Error('Invalid held manifest')
    sources.add(source); artifacts.add(entry.artifactId)
    return { ...selected,
      artifactId: entry.artifactId, generation: entry.generation, size: entry.size, sha256: entry.sha256 }
  }).sort((a, b) => {
    const left = sourceKey(a), right = sourceKey(b)
    return left < right ? -1 : left > right ? 1 : 0
  })
  const version = entries.some(entry => entry.kind === 'related_record') ? 2 : 1
  const bytes = Buffer.from(JSON.stringify({ version, environment: input.environment, operationId: input.operationId,
    ideaId: input.ideaId, holdId: input.holdId, entries }))
  if (bytes.length > maxBytes) throw new Error('Invalid held manifest')
  return bytes
}

export function decodeUnverifiedHeldManifest(payload: Uint8Array, environment: 'dev' | 'prod'): Manifest {
  try {
    if (!(payload instanceof Uint8Array) || payload.byteLength < 1 || payload.byteLength > maxBytes) throw new Error('Invalid')
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !keys(value, ['version', 'environment', 'operationId', 'ideaId', 'holdId', 'entries'])) throw new Error('Invalid')
    const parsed = value as Manifest & { version: number }
    if (![1, 2].includes(parsed.version) || parsed.environment !== environment) throw new Error('Invalid')
    const canonical = encodeUnverifiedHeldManifest({ environment: parsed.environment, operationId: parsed.operationId,
      ideaId: parsed.ideaId, holdId: parsed.holdId, entries: parsed.entries })
    if (!Buffer.from(payload).equals(Buffer.from(canonical))) throw new Error('Invalid')
    return { environment: parsed.environment, operationId: parsed.operationId, ideaId: parsed.ideaId, holdId: parsed.holdId, entries: parsed.entries }
  } catch { throw new Error('Held manifest is invalid or incompatible') }
}

/** Check an already-read manifest against its hold records without asserting scope or coverage. */
export function matchUnverifiedHeldManifest(intentBytes: Uint8Array, confirmationBytes: Uint8Array,
  manifestBytes: Uint8Array, environment: 'dev' | 'prod') {
  try {
    const intent = decodeRecoveryRecord(intentBytes, environment), confirmation = decodeRecoveryRecord(confirmationBytes, environment)
    if (intent.recordType !== 'intent' || intent.decision.kind !== 'hold_placement' ||
        confirmation.recordType !== 'hold_commit_confirmation' || confirmation.version !== 3 ||
        confirmation.operationId !== intent.operationId || !(manifestBytes instanceof Uint8Array)) throw new Error('Invalid')
    summarizeUnverifiedRecovery([intentBytes, confirmationBytes], environment)
    const reference = confirmation.heldManifest
    if (manifestBytes.byteLength !== reference.size || createHash('sha256').update(manifestBytes).digest('hex') !== reference.sha256) throw new Error('Invalid')
    const manifest = decodeUnverifiedHeldManifest(manifestBytes, environment)
    if (manifest.operationId !== intent.operationId || manifest.ideaId !== intent.ideaId || manifest.holdId !== confirmation.holdId ||
        manifest.entries.some(entry => entry.artifactId === reference.artifactId)) throw new Error('Invalid')
    return { manifest, heldManifest: reference, coverageVerified: false as const }
  } catch { throw new Error('Held manifest could not be reconciled') }
}

/** Copy and validate the bounded selection before any asynchronous storage read. */
export function snapshotUnverifiedHeldSources(sources: HeldSource[]): HeldSource[] {
  if (!Array.isArray(sources)) throw new Error('Invalid held source inventory')
  const length = sources.length
  if (!Number.isSafeInteger(length) || length < 1 || length > 10_000) throw new Error('Invalid held source inventory')
  const seen = new Set<string>(), selected: HeldSource[] = []
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(sources, index)) throw new Error('Invalid held source inventory')
    const source = sources[index]
    if (!source || typeof source !== 'object' || Array.isArray(source) ||
        !keys(source, ['kind', ...(source.kind === 'related_record' ? ['sourceType'] : []), 'sourceId', 'sourceGeneration'])) throw new Error('Invalid held source inventory')
    let selection: HeldSource
    try { selection = readSource(source) } catch { throw new Error('Invalid held source inventory') }
    const key = sourceKey(selection)
    if (seen.has(key)) throw new Error('Invalid held source inventory')
    seen.add(key)
    selected.push(selection)
  }
  return selected
}

/**
 * Compare one supplied source inventory with a bound manifest. The caller must
 * independently authenticate the inventory and establish the authorized scope;
 * matching references do not prove that revision bytes or the journal are complete.
 */
export function compareUnverifiedHeldSources(intentBytes: Uint8Array, confirmationBytes: Uint8Array,
  manifestBytes: Uint8Array, environment: 'dev' | 'prod', sources: HeldSource[]) {
  try {
    const selected = snapshotUnverifiedHeldSources(sources)
    const expected = new Set(selected.map(sourceKey))
    const { manifest } = matchUnverifiedHeldManifest(intentBytes, confirmationBytes, manifestBytes, environment)
    if (manifest.entries.length !== expected.size || manifest.entries.some(entry =>
      !expected.has(sourceKey(entry)))) throw new Error('Invalid')
    return { matchedSources: expected.size, scopeVerified: false as const, coverageVerified: false as const }
  } catch { throw new Error('Held source inventory could not be reconciled') }
}
