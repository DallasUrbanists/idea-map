import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Create an owned blocking hold. No moderator route or live grant is enabled. */
export async function escalateModerationRevision(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { revisionId: string, assessmentId: string | null, ownerId: string, reason: string }): Promise<ModeratorAccess<'escalated' | 'already-escalated' | 'owner-unavailable' | 'stale'>> {
  if (!uuid.test(input.revisionId) || !uuid.test(input.ownerId) || (input.assessmentId !== null && (typeof input.assessmentId !== 'string' || !input.assessmentId || Buffer.byteLength(input.assessmentId) > 200)) ||
      typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 1000 || /[\x00-\x1f\x7f]/u.test(input.reason)) throw new Error('Invalid escalation')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ decision: string }>('SELECT public.escalate_moderation_revision($1,$2,$3,$4,$5,$6) AS decision',
      [`firebase:${projectId}`, subject, input.revisionId, input.assessmentId, input.ownerId, input.reason])
    const decision = result.rows[0]?.decision
    if (!['escalated', 'already-escalated', 'owner-unavailable', 'stale'].includes(decision)) throw new Error('Moderator authorization changed')
    return decision as 'escalated' | 'already-escalated' | 'owner-unavailable' | 'stale'
  })
}
