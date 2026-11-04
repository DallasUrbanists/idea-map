import { createHash } from 'node:crypto'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const confirmationNamespace = Buffer.from('3fcbdfb61cb24530807a86a05f5deeb8', 'hex')

type Removal = { kind: 'removal', classification: 'violation' | 'other', reason: string }
type HoldPlacement = { kind: 'hold_placement', caseReference: string, reason: string, authorizationReference: string, scope: string }
type HoldRelease = { kind: 'hold_release', holdId: string, caseReference: string, reason: string,
  authorizationReference: string, scope: string, legalReviewReference: string | null }
type Decision = Removal | HoldPlacement | HoldRelease

export type RecoveryIntent = {
  operationId: string
  environment: 'dev' | 'prod'
  ideaId: string
  actorId: string
  authorizedAt: string
  decision: Decision
}
type IntentRecord = RecoveryIntent & { version: 1, recordType: 'intent' }
type ConfirmationRecord = { version: 1, recordType: 'commit_confirmation', operationId: string, environment: 'dev' | 'prod', confirmedAt: string }
export type HoldAuthorityEvidence = { actorId: string, authority: 'executive_director' | 'delegate', grantedBy: string,
  grantedAt: string, authorizationReference: string }
type HoldConfirmationRecord = { version: 2, recordType: 'hold_commit_confirmation', operationId: string,
  environment: 'dev' | 'prod', confirmedAt: string, holdId: string, placementAuthorityId: string, placedAt: string,
  authorityEvidence: HoldAuthorityEvidence }
export type HeldArtifactReference = { artifactId: string, generation: string, size: number, sha256: string }
type HoldManifestConfirmationRecord = Omit<HoldConfirmationRecord, 'version'> & { version: 3, heldManifest: HeldArtifactReference }

function text(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= maxBytes &&
    Buffer.from(value, 'utf8').toString('utf8') === value && !/[\x00-\x1f\x7f]/u.test(value)
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}
function keys(value: object, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const ordered = [...expected].sort()
  return actual.length === ordered.length && actual.every((key, index) => key === ordered[index])
}

/** Encode canonical decision facts already verified by the calling transaction. */
export function encodeRecoveryIntent(input: RecoveryIntent): Uint8Array {
  if (!input || typeof input !== 'object' || !keys(input, ['operationId', 'environment', 'ideaId', 'actorId', 'authorizedAt', 'decision']) ||
      typeof input.operationId !== 'string' || !operationIdPattern.test(input.operationId) || !['dev', 'prod'].includes(input.environment) ||
      typeof input.ideaId !== 'string' || !uuid.test(input.ideaId) || typeof input.actorId !== 'string' || !uuid.test(input.actorId) || !timestamp(input.authorizedAt) ||
      !input.decision || typeof input.decision !== 'object') throw new Error('Invalid recovery decision')
  const decision = input.decision
  if (decision.kind === 'removal') {
    if (!keys(decision, ['kind', 'classification', 'reason']) || !['violation', 'other'].includes(decision.classification) ||
        !text(decision.reason, 1000)) throw new Error('Invalid recovery decision')
  } else if (decision.kind === 'hold_placement' || decision.kind === 'hold_release') {
    const required = ['kind', 'caseReference', 'reason', 'authorizationReference', 'scope']
    if (decision.kind === 'hold_release') required.push('holdId', 'legalReviewReference')
    if (!keys(decision, required) || !text(decision.caseReference, 300) || !text(decision.reason, 1000) ||
        !text(decision.authorizationReference, 300) || !text(decision.scope, 1000) ||
        (decision.kind === 'hold_release' && (typeof decision.holdId !== 'string' || !uuid.test(decision.holdId) ||
          (decision.legalReviewReference !== null && !text(decision.legalReviewReference, 300))))) throw new Error('Invalid recovery decision')
  } else throw new Error('Invalid recovery decision')
  // Select each field so unexpected prototype properties cannot enter storage.
  const base = { version: 1, recordType: 'intent', operationId: input.operationId, environment: input.environment,
    ideaId: input.ideaId, actorId: input.actorId, authorizedAt: input.authorizedAt }
  let details: Decision
  if (decision.kind === 'removal') details = { kind: decision.kind, classification: decision.classification, reason: decision.reason }
  else if (decision.kind === 'hold_placement') details = { kind: decision.kind, caseReference: decision.caseReference,
    reason: decision.reason, authorizationReference: decision.authorizationReference, scope: decision.scope }
  else details = { kind: decision.kind, holdId: decision.holdId, caseReference: decision.caseReference, reason: decision.reason,
    authorizationReference: decision.authorizationReference, scope: decision.scope, legalReviewReference: decision.legalReviewReference }
  return Buffer.from(JSON.stringify({ ...base, decision: details }))
}

/** Derive a retry-stable confirmation object ID from an opaque operation ID. */
export function recoveryConfirmationRecordId(operationId: string): string {
  if (typeof operationId !== 'string' || !operationIdPattern.test(operationId)) throw new Error('Invalid recovery confirmation')
  // A SHA-256-based UUIDv8 separates deterministic confirmations from v4 intents.
  const bytes = createHash('sha256').update(confirmationNamespace).update(operationId, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x80
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** A caller may encode confirmation only after it knows the database committed. */
export function encodeRecoveryConfirmation(operationId: string, environment: 'dev' | 'prod', confirmedAt: string): Uint8Array {
  if (typeof operationId !== 'string' || !operationIdPattern.test(operationId) || !['dev', 'prod'].includes(environment) || !timestamp(confirmedAt)) {
    throw new Error('Invalid recovery confirmation')
  }
  return Buffer.from(JSON.stringify({ version: 1, recordType: 'commit_confirmation', operationId, environment, confirmedAt }))
}

function microsecondTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
}

/** Record committed hold and authority facts without asserting their authenticity. */
export function encodeRecoveryHoldConfirmation(operationId: string, environment: 'dev' | 'prod', confirmedAt: string,
  holdId: string, placementAuthorityId: string, placedAt: string, authorityEvidence: HoldAuthorityEvidence): Uint8Array {
  if (typeof operationId !== 'string' || !operationIdPattern.test(operationId) || !['dev', 'prod'].includes(environment) ||
      !timestamp(confirmedAt) || typeof holdId !== 'string' || !uuid.test(holdId) ||
      typeof placementAuthorityId !== 'string' || !uuid.test(placementAuthorityId) || !microsecondTimestamp(placedAt) ||
      Date.parse(placedAt) > Date.parse(confirmedAt) || !authorityEvidence || typeof authorityEvidence !== 'object' ||
      !keys(authorityEvidence, ['actorId', 'authority', 'grantedBy', 'grantedAt', 'authorizationReference']) ||
      typeof authorityEvidence.actorId !== 'string' || !uuid.test(authorityEvidence.actorId) ||
      !['executive_director', 'delegate'].includes(authorityEvidence.authority) ||
      typeof authorityEvidence.grantedBy !== 'string' || !uuid.test(authorityEvidence.grantedBy) ||
      !microsecondTimestamp(authorityEvidence.grantedAt) || authorityEvidence.grantedAt > placedAt ||
      !text(authorityEvidence.authorizationReference, 300)) throw new Error('Invalid recovery confirmation')
  const authority = { actorId: authorityEvidence.actorId, authority: authorityEvidence.authority,
    grantedBy: authorityEvidence.grantedBy, grantedAt: authorityEvidence.grantedAt,
    authorizationReference: authorityEvidence.authorizationReference }
  return Buffer.from(JSON.stringify({ version: 2, recordType: 'hold_commit_confirmation', operationId, environment,
    confirmedAt, holdId, placementAuthorityId, placedAt, authorityEvidence: authority }))
}

/** Bind an independently stored manifest reference to a known committed hold. */
export function encodeRecoveryHoldManifestConfirmation(operationId: string, environment: 'dev' | 'prod', confirmedAt: string,
  holdId: string, placementAuthorityId: string, placedAt: string, authorityEvidence: HoldAuthorityEvidence,
  heldManifest: HeldArtifactReference): Uint8Array {
  if (!heldManifest || typeof heldManifest !== 'object' || !keys(heldManifest, ['artifactId', 'generation', 'size', 'sha256']) ||
      typeof heldManifest.artifactId !== 'string' || !operationIdPattern.test(heldManifest.artifactId) ||
      typeof heldManifest.generation !== 'string' || !/^[1-9][0-9]{0,19}$/.test(heldManifest.generation) ||
      !Number.isSafeInteger(heldManifest.size) || heldManifest.size < 1 || heldManifest.size > 16 * 1024 * 1024 ||
      typeof heldManifest.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(heldManifest.sha256)) throw new Error('Invalid recovery confirmation')
  const prior = JSON.parse(Buffer.from(encodeRecoveryHoldConfirmation(operationId, environment, confirmedAt,
    holdId, placementAuthorityId, placedAt, authorityEvidence)).toString('utf8')) as HoldConfirmationRecord
  return Buffer.from(JSON.stringify({ ...prior, version: 3, heldManifest: { artifactId: heldManifest.artifactId,
    generation: heldManifest.generation, size: heldManifest.size, sha256: heldManifest.sha256 } }))
}

/** Reject noncanonical, wrong-environment, or incompatible records during recovery. */
export function decodeRecoveryRecord(payload: Uint8Array, environment: 'dev' | 'prod'): IntentRecord | ConfirmationRecord | HoldConfirmationRecord | HoldManifestConfirmationRecord {
  try {
    if (!(payload instanceof Uint8Array) || payload.byteLength < 1 || payload.byteLength > 16_384 || !['dev', 'prod'].includes(environment)) {
      throw new Error('Invalid record')
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid record')
    const record = value as IntentRecord | ConfirmationRecord | HoldConfirmationRecord | HoldManifestConfirmationRecord
    if (record.environment !== environment) throw new Error('Invalid record')
    let canonical: Uint8Array
    if (record.version === 1 && record.recordType === 'intent') {
      if (!keys(record, ['version', 'recordType', 'operationId', 'environment', 'ideaId', 'actorId', 'authorizedAt', 'decision'])) throw new Error('Invalid record')
      canonical = encodeRecoveryIntent({ operationId: record.operationId, environment: record.environment,
        ideaId: record.ideaId, actorId: record.actorId, authorizedAt: record.authorizedAt, decision: record.decision })
    } else if (record.version === 1 && record.recordType === 'commit_confirmation') {
      if (!keys(record, ['version', 'recordType', 'operationId', 'environment', 'confirmedAt'])) throw new Error('Invalid record')
      canonical = encodeRecoveryConfirmation(record.operationId, record.environment, record.confirmedAt)
    } else if (record.version === 2 && record.recordType === 'hold_commit_confirmation') {
      if (!keys(record, ['version', 'recordType', 'operationId', 'environment', 'confirmedAt', 'holdId', 'placementAuthorityId', 'placedAt', 'authorityEvidence'])) throw new Error('Invalid record')
      canonical = encodeRecoveryHoldConfirmation(record.operationId, record.environment, record.confirmedAt, record.holdId,
        record.placementAuthorityId, record.placedAt, record.authorityEvidence)
    } else if (record.version === 3 && record.recordType === 'hold_commit_confirmation') {
      if (!keys(record, ['version', 'recordType', 'operationId', 'environment', 'confirmedAt', 'holdId', 'placementAuthorityId', 'placedAt', 'authorityEvidence', 'heldManifest'])) throw new Error('Invalid record')
      canonical = encodeRecoveryHoldManifestConfirmation(record.operationId, record.environment, record.confirmedAt, record.holdId,
        record.placementAuthorityId, record.placedAt, record.authorityEvidence, record.heldManifest)
    } else throw new Error('Invalid record')
    if (!Buffer.from(payload).equals(Buffer.from(canonical))) throw new Error('Invalid record')
    return record
  } catch {
    throw new Error('Recovery record is invalid or incompatible')
  }
}
