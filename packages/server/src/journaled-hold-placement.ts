import { withLegalAuthority } from './legal-holds.js'
import type { RegisteredSessionVerifier } from './moderator-authorization.js'
import { encodeRecoveryHoldConfirmation, encodeRecoveryIntent, type HoldAuthorityEvidence } from './recovery-journal-record.js'
import { recordVerifiedHoldDecision, verifyJournalCheckpoint, type JournalCheckpoint, type JournalProgress, type JournalTransports } from './recovery-sequence-decision.js'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const uuid4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

type PlacementRequest = { ideaId: string, requestId: string, caseReference: string, reason: string }
type PreparedPlacement = JournalProgress & {
  holdId: string
  assignmentId: string
  caseReference: string
  authorizedAt: string
  placedAt: string
  authority: HoldAuthorityEvidence
}

export function readJournaledHoldPlacementRequest(body: unknown): PlacementRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 4) return null
  const { ideaId, requestId, caseReference, reason } = body as Partial<PlacementRequest>
  if (typeof ideaId !== 'string' || !uuid.test(ideaId) || typeof requestId !== 'string' || !uuid4.test(requestId) ||
      typeof caseReference !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(caseReference) ||
      typeof reason !== 'string' || !reason.trim() || Buffer.byteLength(reason) > 1000 ||
      Buffer.from(reason).toString('utf8') !== reason || /[\x00-\x1f\x7f]/u.test(reason)) return null
  return { ideaId, requestId, caseReference, reason }
}

/** Commit broad protection, then record the placement with independent readback. */
export async function placeHoldThroughRecoveryJournal(
  preparationDatabaseUrl: string, coordinatorDatabaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, journal: JournalCheckpoint, transports: JournalTransports, input: PlacementRequest,
) {
  const target = { ...journal }
  const decision = readJournaledHoldPlacementRequest(input)
  if (!decision) throw new Error('Invalid hold placement')
  const baseline = [target.environment, target.projectNumber, target.secretId, target.epochId, target.checkpointDigest]
  const prepare = await withLegalAuthority(preparationDatabaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    const { rows } = await client.query<{ placement: PreparedPlacement | null }>(
      'SELECT public.prepare_journaled_hold_placement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS placement',
      [provider, subject, decision.ideaId, decision.requestId, decision.caseReference, decision.reason, ...baseline],
    )
    if (rows.length !== 1) throw new Error('Hold placement unavailable')
    return rows[0]!.placement
  })
  if (prepare.state !== 'authorized') return prepare
  const placed = prepare.value
  if (!placed) return { state: 'authorized' as const, value: 'stale' as const }

  // A failed provider operation leaves the broad hold committed in PostgreSQL.
  await verifyJournalCheckpoint(transports.reader, target)
  const operationId = placed.holdId
  const intent = encodeRecoveryIntent({
    operationId, environment: target.environment, ideaId: decision.ideaId, actorId: placed.authority.actorId,
    authorizedAt: placed.authorizedAt, decision: { kind: 'hold_placement', caseReference: placed.caseReference,
      reason: 'Authorized preservation', authorizationReference: placed.authority.authorizationReference, scope: 'Provisional broad protection' },
  })
  const advance = (intentVersion: number, confirmationVersion: number | null) =>
    withLegalAuthority(coordinatorDatabaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
      const { rows } = await client.query<{ progress: JournalProgress }>(
        'SELECT public.advance_journaled_hold_placement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS progress',
        [provider, subject, decision.requestId, operationId, ...baseline, intentVersion, confirmationVersion],
      )
      if (rows.length !== 1) throw new Error('Hold journal checkpoint unavailable')
      return rows[0]!.progress
    })

  const recorded = await recordVerifiedHoldDecision(transports, target, operationId, intent, placed,
    confirmedAt => encodeRecoveryHoldConfirmation(operationId, target.environment, confirmedAt,
      placed.holdId, placed.assignmentId, placed.placedAt, placed.authority), advance)
  if (recorded.state !== 'authorized') return recorded

  return { state: 'authorized' as const, value: { state: 'held' as const, holdId: placed.holdId, scope: 'provisional' as const } }
}
