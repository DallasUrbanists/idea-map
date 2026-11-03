import { decodeRecoveryRecord } from './recovery-journal-record.js'

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
  const confirmations = new Map<string, Extract<ReturnType<typeof decodeRecoveryRecord>, { recordType: 'commit_confirmation' }>>()
  for (const payload of records) {
    const record = decodeRecoveryRecord(payload, environment)
    const target = record.recordType === 'intent' ? intents : confirmations
    if (target.has(record.operationId)) throw new Error('Recovery inventory is ambiguous')
    if (record.recordType === 'intent') intents.set(record.operationId, record)
    else confirmations.set(record.operationId, record)
  }
  const removals = new Set<string>()
  const holdPlacements = new Set<string>()
  const reviewOperations = new Set<string>()
  for (const [operationId, intent] of intents) {
    const confirmation = confirmations.get(operationId)
    if (confirmation && Date.parse(confirmation.confirmedAt) < Date.parse(intent.authorizedAt)) throw new Error('Recovery inventory is ambiguous')
    if (intent.decision.kind === 'removal') removals.add(intent.ideaId)
    if (intent.decision.kind === 'hold_placement') holdPlacements.add(intent.ideaId)
    // Unconfirmed decisions and every release need an authorized review. A
    // release record alone never removes a hold or restores public access.
    if (!confirmation || intent.decision.kind === 'hold_release') reviewOperations.add(operationId)
  }
  let unmatchedConfirmations = 0
  for (const operationId of confirmations.keys()) if (!intents.has(operationId)) unmatchedConfirmations++
  return { removals: [...removals].sort(), holdPlacements: [...holdPlacements].sort(),
    reviewOperations: [...reviewOperations].sort(), unmatchedConfirmations, coverageVerified: false as const }
}
