import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Transfer an active escalation without releasing its publication block. */
export async function transferModeratorEscalation(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { holdId: string, revisionId: string, assessmentId: string | null, expectedSequence: number, ownerId: string, reason: string }): Promise<ModeratorAccess<'transferred' | 'unchanged' | 'owner-unavailable' | 'not-active' | 'stale'>> {
  if (!uuid.test(input.holdId) || !uuid.test(input.revisionId) || !uuid.test(input.ownerId) ||
      !Number.isSafeInteger(input.expectedSequence) || input.expectedSequence < 0 || input.expectedSequence >= 2147483647 ||
      (input.assessmentId !== null && (typeof input.assessmentId !== 'string' || !input.assessmentId || Buffer.byteLength(input.assessmentId) > 200)) ||
      typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 1000 || /[\x00-\x1f\x7f]/u.test(input.reason)) throw new Error('Invalid escalation transfer')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ decision: string }>('SELECT public.transfer_moderator_escalation($1,$2,$3,$4,$5,$6,$7,$8) AS decision',
      [`firebase:${projectId}`, subject, input.holdId, input.revisionId, input.assessmentId, input.expectedSequence, input.ownerId, input.reason])
    const decision = result.rows[0]?.decision
    if (!['transferred', 'unchanged', 'owner-unavailable', 'not-active', 'stale'].includes(decision)) throw new Error('Moderator authorization changed')
    return decision as 'transferred' | 'unchanged' | 'owner-unavailable' | 'not-active' | 'stale'
  })
}
