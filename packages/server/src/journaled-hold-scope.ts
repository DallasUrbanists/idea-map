import type { Storage } from '@google-cloud/storage'
import { verifyHeldInventorySources } from './held-inventory-capture.js'
import { withLegalAuthority } from './legal-holds.js'
import type { RegisteredSessionVerifier } from './moderator-authorization.js'
import { verifyHeldScopeInventory } from './recovery-held-verification.js'
import { encodeRecoveryConfirmation, encodeRecoveryIntent, type HeldArtifactReference } from './recovery-journal-record.js'
import { recordVerifiedHoldDecision, verifyJournalCheckpoint, type JournalCheckpoint, type JournalProgress, type JournalTransports } from './recovery-sequence-decision.js'

type ScopeReviewRequest = { holdId: string, operationId: string, inventory: HeldArtifactReference }
type PreparedReview = JournalProgress & { ideaId: string, caseReference: string, actorId: string, authorizationReference: string, authorizedAt: string }

/**
 * Record an authorized scope review of the exact held inventory. This is
 * evidence for disposition review. It never clears another hold or deletes data.
 */
export async function recordJournaledHoldScopeReview(
  preparationDatabaseUrl: string, coordinatorDatabaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, journal: JournalCheckpoint, transports: JournalTransports,
  storage: { held: Storage, source: Storage }, heldBucket: string, sourceBuckets: { upload: string, preview: string },
  request: ScopeReviewRequest,
) {
  const target = { ...journal }, { holdId, operationId } = request
  const inventory = { ...request.inventory }, buckets = { ...sourceBuckets }
  const baseline = [target.environment, target.projectNumber, target.secretId, target.epochId, target.checkpointDigest]
  const prepared = await withLegalAuthority(preparationDatabaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    const { rows } = await client.query<{ review: PreparedReview }>(
      'SELECT public.prepare_journaled_hold_scope_review($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) AS review',
      [provider, subject, holdId, operationId, JSON.stringify(inventory), ...baseline],
    )
    if (rows.length !== 1) throw new Error('Hold scope review unavailable')
    return rows[0]!.review
  })
  if (prepared.state !== 'authorized') return prepared
  const review = prepared.value
  const intent = encodeRecoveryIntent({
    operationId, environment: target.environment, ideaId: review.ideaId, actorId: review.actorId, authorizedAt: review.authorizedAt,
    decision: { kind: 'hold_scope_review', holdId, caseReference: review.caseReference,
      authorizationReference: review.authorizationReference, selectedInventory: inventory },
  })

  await verifyJournalCheckpoint(transports.reader, target)
  const deadline = performance.now() + 120_000
  const remaining = () => {
    const ms = Math.ceil(deadline - performance.now())
    if (ms < 1) throw new Error('Hold scope review timed out')
    return Math.min(ms, 5000)
  }
  const destination = { environment: target.environment, projectNumber: target.projectNumber, bucket: heldBucket }
  const { manifest } = await verifyHeldScopeInventory(storage.held, destination, inventory,
    { operationId, holdId, ideaId: review.ideaId }, remaining, 96 * 1024 * 1024)
  // A committed scope review is historical. Retrying it still checks the held
  // capture, but does not require a newer version of the primary row to match.
  if (review.intentVersion === null) {
    const sources = await verifyHeldInventorySources(preparationDatabaseUrl, projectId, cookie, verifier, storage.source, buckets, manifest, remaining)
    if (sources.state !== 'authorized') return sources
  }

  const advance = (intentVersion: number, confirmationVersion: number | null) =>
    withLegalAuthority(coordinatorDatabaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
      const { rows } = await client.query<{ progress: JournalProgress }>(
        'SELECT public.advance_journaled_hold_scope_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS progress',
        [provider, subject, holdId, operationId, ...baseline, intentVersion, confirmationVersion],
      )
      if (rows.length !== 1) throw new Error('Hold scope checkpoint unavailable')
      return rows[0]!.progress
    })
  const recorded = await recordVerifiedHoldDecision(transports, target, operationId, intent, review,
    confirmedAt => encodeRecoveryConfirmation(operationId, target.environment, confirmedAt), advance)
  if (recorded.state !== 'authorized') return recorded

  return { state: 'authorized' as const, value: { state: 'recorded' as const, holdId, operationId, selectedSources: manifest.entries.length } }
}
