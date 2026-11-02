import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Server-only. A projection intent is not evidence that caches were invalidated. */
export async function removePublishedIdea(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { ideaId: string, approvedRevisionId: string, classification: 'violation' | 'other', reason: string }): Promise<ModeratorAccess<'removed' | 'stale'>> {
  if (!uuid.test(input.ideaId) || !uuid.test(input.approvedRevisionId) || !['violation', 'other'].includes(input.classification) ||
      typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 1000 || /[\x00-\x1f\x7f]/u.test(input.reason)) throw new Error('Invalid moderator removal')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ decision: string }>('SELECT public.remove_published_idea($1,$2,$3,$4,$5,$6) AS decision',
      [`firebase:${projectId}`, subject, input.ideaId, input.approvedRevisionId, input.classification, input.reason])
    const decision = result.rows[0]?.decision
    if (decision !== 'removed' && decision !== 'stale') throw new Error('Moderator authorization changed')
    return decision
  })
}
