import { decodeRecoveryRecord, type HeldArtifactReference, type HoldAuthorityEvidence } from './recovery-journal-record.js'

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
  const holdCases = new Map<string, string>()
  const assignments = new Map<string, HoldAuthorityEvidence>()
  function checkHoldIdentity(holdId: string, ideaId: string, caseReference: string) {
    const existing = holdIdeas.get(holdId)
    if (existing !== undefined && existing !== ideaId) throw new Error('Recovery inventory is ambiguous')
    holdIdeas.set(holdId, ideaId)
    // The existing placement function stores PostgreSQL trim(text), which
    // removes ASCII spaces. A hold's stored case reference is immutable.
    const normalizedCase = caseReference.replace(/^ +| +$/g, '')
    const existingCase = holdCases.get(holdId)
    if (existingCase !== undefined && existingCase !== normalizedCase) throw new Error('Recovery inventory is ambiguous')
    holdCases.set(holdId, normalizedCase)
  }
  const holdIdentities: { operationId: string, ideaId: string, holdId: string,
    placementAuthorityId: string, placedAt: string, authorityEvidence: HoldAuthorityEvidence, heldManifest?: HeldArtifactReference }[] = []
  for (const [operationId, intent] of intents) {
    const confirmation = confirmations.get(operationId)
    if (confirmation && Date.parse(confirmation.confirmedAt) < Date.parse(intent.authorizedAt)) throw new Error('Recovery inventory is ambiguous')
    if (confirmation?.recordType === 'hold_commit_confirmation') {
      if (intent.decision.kind !== 'hold_placement' || placedHoldIds.has(confirmation.holdId)) throw new Error('Recovery inventory is ambiguous')
      placedHoldIds.add(confirmation.holdId)
      checkHoldIdentity(confirmation.holdId, intent.ideaId, intent.decision.caseReference)
      const evidence = confirmation.authorityEvidence
      const previous = assignments.get(confirmation.placementAuthorityId)
      if (Date.parse(confirmation.placedAt) < Date.parse(intent.authorizedAt) ||
          evidence.actorId !== intent.actorId ||
          (previous && (previous.actorId !== evidence.actorId || previous.authority !== evidence.authority ||
            previous.grantedBy !== evidence.grantedBy || previous.grantedAt !== evidence.grantedAt ||
            previous.authorizationReference !== evidence.authorizationReference))) {
        throw new Error('Recovery inventory is ambiguous')
      }
      assignments.set(confirmation.placementAuthorityId, evidence)
      holdIdentities.push({ operationId, ideaId: intent.ideaId, holdId: confirmation.holdId,
        placementAuthorityId: confirmation.placementAuthorityId, placedAt: confirmation.placedAt, authorityEvidence: confirmation.authorityEvidence,
        ...(confirmation.version === 3 ? { heldManifest: confirmation.heldManifest } : {}) })
    }
    if (intent.decision.kind === 'removal') removals.add(intent.ideaId)
    if (intent.decision.kind === 'hold_placement') holdPlacements.add(intent.ideaId)
    if (intent.decision.kind === 'hold_release' || intent.decision.kind === 'hold_scope_review') {
      checkHoldIdentity(intent.decision.holdId, intent.ideaId, intent.decision.caseReference)
    }
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
