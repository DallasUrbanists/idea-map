import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Server-only primitive. No route, permissions, or publication automation are enabled. */
export async function rejectModerationRevision(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { revisionId: string, assessmentId: string | null, reason: string }): Promise<ModeratorAccess<'rejected' | 'stale'>> {
  if (!uuid.test(input.revisionId) || (input.assessmentId !== null && (typeof input.assessmentId !== 'string' || !input.assessmentId || Buffer.byteLength(input.assessmentId) > 200)) ||
      typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 1000 || /[\x00-\x1f\x7f]/u.test(input.reason)) throw new Error('Invalid moderation decision')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ decision: string }>('SELECT public.reject_moderation_revision($1,$2,$3,$4,$5) AS decision',
      [`firebase:${projectId}`, subject, input.revisionId, input.assessmentId, input.reason])
    const decision = result.rows[0]?.decision
    if (decision !== 'rejected' && decision !== 'stale') throw new Error('Moderator authorization changed')
    return decision
  })
}
