import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
interface ChangeAction { revisionId: string, assessmentId: string | null, reason: string }
type ChangeResult = 'requested' | 'already-requested' | 'resolved' | 'not-requested' | 'stale'

/** Server-only. The caller must use the configured Firebase Admin verifier. */
async function changeAction(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  action: 'request' | 'resolve', input: ChangeAction, requestId: string | null): Promise<ModeratorAccess<ChangeResult>> {
  if (!uuid.test(input.revisionId) || (input.assessmentId !== null && (typeof input.assessmentId !== 'string' || !input.assessmentId || Buffer.byteLength(input.assessmentId) > 200)) ||
      typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 1000 || /[\x00-\x1f\x7f]/u.test(input.reason) ||
      (requestId !== null && !uuid.test(requestId))) throw new Error('Invalid moderator change request')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ decision: string }>('SELECT public.apply_moderator_change_request($1,$2,$3,$4,$5,$6,$7) AS decision',
      [`firebase:${projectId}`, subject, action, input.revisionId, input.assessmentId, requestId, input.reason])
    const decision = result.rows[0]?.decision
    if (!['requested', 'already-requested', 'resolved', 'not-requested', 'stale'].includes(decision)) throw new Error('Moderator authorization changed')
    return decision as ChangeResult
  })
}

export function requestModeratorChanges(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier, input: ChangeAction) {
  return changeAction(databaseUrl, projectId, cookie, verifier, 'request', input, null)
}

/** Resolve only this request, without clearing holds or other review blocks. */
export function resolveModeratorChanges(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier, input: ChangeAction & { requestId: string }) {
  if (!uuid.test(input.requestId)) throw new Error('Invalid moderator change request')
  return changeAction(databaseUrl, projectId, cookie, verifier, 'resolve', input, input.requestId)
}
