import { decodeRecoveryRecord, type HoldAuthorityEvidence } from './recovery-journal-record.js'

/**
 * Summarize decoded records conservatively. This does not prove the inventory
 * is complete, verify authorization, change data, or authorize public access.
 */
export function summarizeUnverifiedRecovery(records: Uint8Array[], environment: 'dev' | 'prod') {
  if (!['dev', 'prod'].includes(environment) || !Array.isArray(records) || records.length > 100_000 ||
      records.some(record => !(record instanceof Uint8Array)) ||
      records.reduce((total, record) => total + record.byteLength, 0) > 32 * 1024 * 1024) {
    throw new Error('Recovery inventory is invalid')
  }
  const intents = new Map<string, Extract<ReturnType<typeof decodeRecoveryRecord>, { recordType: 'intent' }>>()
  const confirmations = new Map<string, Exclude<ReturnType<typeof decodeRecoveryRecord>, { recordType: 'intent' }>>()
  for (const payload of records) {
    const record = decodeRecoveryRecord(payload, environment)
    const target = record.recordType === 'intent' ? intents : confirmations
    if (target.has(record.operationId)) throw new Error('Recovery inventory is ambiguous')
    if (record.recordType === 'intent') intents.set(record.operationId, record)
    else confirmations.set(record.operationId, record)
  }
  const removals = new Set<string>()
  const holdPlacements = new Set<string>()
  const holdReviewIdeas = new Set<string>()
  const reviewOperations = new Set<string>()
  const placedHoldIds = new Set<string>()
  const holdIdeas = new Map<string, string>()
  function checkHoldIdea(holdId: string, ideaId: string) {
    const existing = holdIdeas.get(holdId)
    if (existing !== undefined && existing !== ideaId) throw new Error('Recovery inventory is ambiguous')
    holdIdeas.set(holdId, ideaId)
  }
  const holdIdentities: { operationId: string, ideaId: string, holdId: string,
    placementAuthorityId: string, placedAt: string, authorityEvidence: HoldAuthorityEvidence }[] = []
  for (const [operationId, intent] of intents) {
    const confirmation = confirmations.get(operationId)
    if (confirmation && Date.parse(confirmation.confirmedAt) < Date.parse(intent.authorizedAt)) throw new Error('Recovery inventory is ambiguous')
    if (confirmation?.recordType === 'hold_commit_confirmation') {
      if (intent.decision.kind !== 'hold_placement' || placedHoldIds.has(confirmation.holdId)) throw new Error('Recovery inventory is ambiguous')
      placedHoldIds.add(confirmation.holdId)
      checkHoldIdea(confirmation.holdId, intent.ideaId)
      if (Date.parse(confirmation.placedAt) < Date.parse(intent.authorizedAt) ||
          confirmation.authorityEvidence.actorId !== intent.actorId ||
          confirmation.authorityEvidence.authorizationReference !== intent.decision.authorizationReference) {
        throw new Error('Recovery inventory is ambiguous')
      }
      holdIdentities.push({ operationId, ideaId: intent.ideaId, holdId: confirmation.holdId,
        placementAuthorityId: confirmation.placementAuthorityId, placedAt: confirmation.placedAt, authorityEvidence: confirmation.authorityEvidence })
    }
    if (intent.decision.kind === 'removal') removals.add(intent.ideaId)
    if (intent.decision.kind === 'hold_placement') holdPlacements.add(intent.ideaId)
    if (intent.decision.kind === 'hold_release') checkHoldIdea(intent.decision.holdId, intent.ideaId)
    if (intent.decision.kind !== 'removal') holdReviewIdeas.add(intent.ideaId)
    // Even a confirmed placement lacks the authority and held-material evidence
    // needed to recreate it. Releases and uncertain decisions also need review.
    if (!confirmation || intent.decision.kind !== 'removal') reviewOperations.add(operationId)
  }
  let unmatchedConfirmations = 0
  for (const operationId of confirmations.keys()) {
    if (!intents.has(operationId)) {
      unmatchedConfirmations++
      reviewOperations.add(operationId)
    }
  }
  holdIdentities.sort((left, right) => left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0)
  return { removals: [...removals].sort(), holdPlacements: [...holdPlacements].sort(), holdReviewIdeas: [...holdReviewIdeas].sort(), holdIdentities,
    reviewOperations: [...reviewOperations].sort(), unmatchedConfirmations, coverageVerified: false as const }
}

type JournalReference = { recordId: string, generation: string, metageneration: string, crc32c: string }
const recordId = /^[0-9a-f]{8}-[0-9a-f]{4}-[48][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Compare an independently supplied checkpoint with an inventory. This reports
 * discrepancies; it does not establish checkpoint authenticity or completeness.
 */
export function compareUnverifiedRecoveryCheckpoint(checkpoint: JournalReference[], current: JournalReference[]) {
  function index(references: JournalReference[]) {
    if (!Array.isArray(references) || references.length > 10_000) throw new Error('Recovery checkpoint is invalid')
    const result = new Map<string, JournalReference>()
    for (const reference of references) {
      if (!reference || typeof reference !== 'object' || Object.keys(reference).sort().join(',') !== 'crc32c,generation,metageneration,recordId' ||
          typeof reference.recordId !== 'string' || !recordId.test(reference.recordId) ||
          typeof reference.generation !== 'string' || !/^[1-9][0-9]*$/.test(reference.generation) ||
          reference.generation.length > 20 || typeof reference.metageneration !== 'string' ||
          !/^[1-9][0-9]{0,19}$/.test(reference.metageneration) || typeof reference.crc32c !== 'string' ||
          !/^[A-Za-z0-9+/]{6}==$/.test(reference.crc32c) || result.has(reference.recordId)) {
        throw new Error('Recovery checkpoint is invalid')
      }
      result.set(reference.recordId, reference)
    }
    return result
  }
  const expected = index(checkpoint)
  const observed = index(current)
  const missing: string[] = []
  const changed: string[] = []
  const additional: string[] = []
  for (const [id, reference] of expected) {
    const actual = observed.get(id)
    if (!actual) missing.push(id)
    else if (actual.generation !== reference.generation || actual.metageneration !== reference.metageneration ||
      actual.crc32c !== reference.crc32c) changed.push(id)
  }
  for (const id of observed.keys()) if (!expected.has(id)) additional.push(id)
  return { missing: missing.sort(), changed: changed.sort(), additional: additional.sort(), coverageVerified: false as const }
}
