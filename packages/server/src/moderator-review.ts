import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'

export interface ModeratorRevision {
  ideaId: string
  revisionId: string
  version: number
  content: unknown
  reviewState: string
  assessmentId: string | null
  assessmentReceivedAt: string | null
  deadline: string | null
  blocked: boolean
  activeHoldCount: number
  activeChangeRequestCount: number
  activeHolds: Array<{ id: string, kind: 'hold' | 'escalation', reason: string, placedAt: string, ownerId: string | null, sequence: number }>
  activeChangeRequests: Array<{ id: string, reason: string, requestedAt: string }>
}

/** Private review data; caller must verify its configured Firebase project. */
export async function readModeratorRevision(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  revisionId: string): Promise<ModeratorAccess<ModeratorRevision | null>> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(revisionId)) throw new Error('Invalid moderator revision')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ revision: ModeratorRevision | null }>('SELECT public.read_moderator_revision($1,$2,$3) AS revision',
      [`firebase:${projectId}`, subject, revisionId])
    return result.rows[0].revision
  })
}
