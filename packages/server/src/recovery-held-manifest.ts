import { createHash } from 'node:crypto'
import { decodeRecoveryRecord, type HeldArtifactReference } from './recovery-journal-record.js'
import { summarizeUnverifiedRecovery } from './recovery-journal-plan.js'

type Entry = HeldArtifactReference & { kind: 'revision' | 'media', sourceId: string, sourceGeneration: string | null }
type Manifest = { environment: 'dev' | 'prod', operationId: string, ideaId: string, holdId: string, entries: Entry[] }
export type HeldSource = Pick<Entry, 'kind' | 'sourceId' | 'sourceGeneration'>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const generation = /^[1-9][0-9]{0,19}$/
const digest = /^[0-9a-f]{64}$/
const maxBytes = 16 * 1024 * 1024

function keys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort(), wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

/** Encode only explicitly selected references; this does not establish legal scope. */
export function encodeUnverifiedHeldManifest(input: Manifest): Uint8Array {
  if (!input || typeof input !== 'object' || !keys(input, ['environment', 'operationId', 'ideaId', 'holdId', 'entries']) ||
      !['dev', 'prod'].includes(input.environment) || typeof input.operationId !== 'string' || !uuid4.test(input.operationId) ||
      typeof input.ideaId !== 'string' || !uuid.test(input.ideaId) || typeof input.holdId !== 'string' || !uuid.test(input.holdId) ||
      !Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 10_000) throw new Error('Invalid held manifest')
  const sources = new Set<string>(), artifacts = new Set<string>()
  const entries = input.entries.map(entry => {
    if (!entry || typeof entry !== 'object' || !keys(entry, ['kind', 'sourceId', 'sourceGeneration', 'artifactId', 'generation', 'size', 'sha256']) ||
        !['revision', 'media'].includes(entry.kind) || typeof entry.sourceId !== 'string' || !uuid.test(entry.sourceId) ||
        (entry.kind === 'revision' ? entry.sourceGeneration !== null : typeof entry.sourceGeneration !== 'string' || !generation.test(entry.sourceGeneration)) ||
        typeof entry.artifactId !== 'string' || !uuid4.test(entry.artifactId) || typeof entry.generation !== 'string' || !generation.test(entry.generation) ||
        !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > maxBytes || typeof entry.sha256 !== 'string' || !digest.test(entry.sha256)) {
      throw new Error('Invalid held manifest')
    }
    const source = `${entry.kind}:${entry.sourceId}:${entry.sourceGeneration ?? ''}`
    if (sources.has(source) || artifacts.has(entry.artifactId)) throw new Error('Invalid held manifest')
    sources.add(source); artifacts.add(entry.artifactId)
    return { kind: entry.kind, sourceId: entry.sourceId, sourceGeneration: entry.sourceGeneration,
      artifactId: entry.artifactId, generation: entry.generation, size: entry.size, sha256: entry.sha256 }
  }).sort((a, b) => {
    const left = `${a.kind}:${a.sourceId}:${a.sourceGeneration ?? ''}`, right = `${b.kind}:${b.sourceId}:${b.sourceGeneration ?? ''}`
    return left < right ? -1 : left > right ? 1 : 0
  })
  const bytes = Buffer.from(JSON.stringify({ version: 1, environment: input.environment, operationId: input.operationId,
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
    if (parsed.version !== 1 || parsed.environment !== environment) throw new Error('Invalid')
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
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 10_000) throw new Error('Invalid held source inventory')
  const seen = new Set<string>(), selected: HeldSource[] = []
  const length = sources.length
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(sources, index)) throw new Error('Invalid held source inventory')
    const source = sources[index]
    if (!source || typeof source !== 'object' || !keys(source, ['kind', 'sourceId', 'sourceGeneration'])) throw new Error('Invalid held source inventory')
    const { kind, sourceId, sourceGeneration } = source
    if (!['revision', 'media'].includes(kind) || typeof sourceId !== 'string' || !uuid.test(sourceId) ||
        (kind === 'revision' ? sourceGeneration !== null : typeof sourceGeneration !== 'string' || !generation.test(sourceGeneration))) {
      throw new Error('Invalid held source inventory')
    }
    const key = `${kind}:${sourceId}:${sourceGeneration ?? ''}`
    if (seen.has(key)) throw new Error('Invalid held source inventory')
    seen.add(key)
    selected.push({ kind, sourceId, sourceGeneration })
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
    const expected = new Set(selected.map(source => `${source.kind}:${source.sourceId}:${source.sourceGeneration ?? ''}`))
    const { manifest } = matchUnverifiedHeldManifest(intentBytes, confirmationBytes, manifestBytes, environment)
    if (manifest.entries.length !== expected.size || manifest.entries.some(entry =>
      !expected.has(`${entry.kind}:${entry.sourceId}:${entry.sourceGeneration ?? ''}`))) throw new Error('Invalid')
    return { matchedSources: expected.size, scopeVerified: false as const, coverageVerified: false as const }
  } catch { throw new Error('Held source inventory could not be reconciled') }
}
