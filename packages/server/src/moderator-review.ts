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

export interface ModeratorQueueEntry { revisionId: string, createdAt: string, reviewState: string, version: number }
export interface ModeratorQueueCursor { createdAt: string, revisionId: string }

export function validModeratorQueueCursor(cursor: ModeratorQueueCursor): boolean {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.revisionId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(cursor.createdAt) || cursor.createdAt < '1000-01-01' || Number.isNaN(Date.parse(cursor.createdAt))) return false
  return new Date(cursor.createdAt).toISOString().slice(0, 19) === cursor.createdAt.slice(0, 19)
}

/** List only bounded metadata; opening a revision performs a fresh review check. */
export async function listModeratorQueue(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  cursor: ModeratorQueueCursor | null): Promise<ModeratorAccess<{ entries: ModeratorQueueEntry[], next: ModeratorQueueCursor | null }>> {
  if (cursor && !validModeratorQueueCursor(cursor)) throw new Error('Invalid moderator queue cursor')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ revision_id: string, created_at_text: string, review_state: string, version: number }>(
      'SELECT * FROM public.list_moderator_queue($1,$2,$3,$4)', [`firebase:${projectId}`, subject, cursor?.createdAt ?? null, cursor?.revisionId ?? null])
    const entries = result.rows.slice(0, 50).map(row => ({ revisionId: row.revision_id, createdAt: row.created_at_text, reviewState: row.review_state, version: row.version }))
    const last = entries.at(-1)
    return { entries, next: result.rows.length > 50 && last ? { createdAt: last.createdAt, revisionId: last.revisionId } : null }
  })
}

/** Internal IDs only; assignment transactions independently recheck active roles. */
export async function listModeratorOwners(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier):
  Promise<ModeratorAccess<Array<{ userId: string, isSelf: boolean }>>> {
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ user_id: string, is_self: boolean }>('SELECT * FROM public.list_moderator_owners($1,$2)',
      [`firebase:${projectId}`, subject])
    return result.rows.map(row => ({ userId: row.user_id, isSelf: row.is_self }))
  })
}
