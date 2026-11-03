import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'

export interface HoldRequest {
  revisionId: string
  /** The assessment visible to the reviewer, or null when none was available. */
  assessmentId: string | null
  reason: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function validate(input: HoldRequest) {
  if (!uuid.test(input.revisionId) || (input.assessmentId !== null && (typeof input.assessmentId !== 'string' || !input.assessmentId || Buffer.byteLength(input.assessmentId) > 200)) ||
      typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 1000 || /[\x00-\x1f\x7f]/u.test(input.reason)) throw new Error('Invalid moderator hold')
}

/** Server-only primitive; the database function requires separately reviewed grants. */
export async function placeModeratorHold(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: HoldRequest): Promise<ModeratorAccess<'placed' | 'stale' | 'already-held'>> {
  validate(input)
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ decision: string }>('SELECT public.apply_moderator_hold($1,$2,$3,$4,$5,$6,$7) AS decision',
      [`firebase:${projectId}`, subject, 'place', input.revisionId, input.assessmentId, null, input.reason])
    const decision = result.rows[0]?.decision
    if (decision !== 'placed' && decision !== 'stale' && decision !== 'already-held') throw new Error('Moderator authorization changed')
    return decision
  })
}

/** A release resolves only the named hold and cannot clear another review block. */
export async function releaseModeratorHold(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: HoldRequest & { holdId: string }): Promise<ModeratorAccess<'released' | 'stale' | 'not-held'>> {
  validate(input)
  if (!uuid.test(input.holdId)) throw new Error('Invalid moderator hold')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const result = await client.query<{ decision: string }>('SELECT public.apply_moderator_hold($1,$2,$3,$4,$5,$6,$7) AS decision',
      [`firebase:${projectId}`, subject, 'release', input.revisionId, input.assessmentId, input.holdId, input.reason])
    const decision = result.rows[0]?.decision
    if (decision !== 'released' && decision !== 'stale' && decision !== 'not-held') throw new Error('Moderator authorization changed')
    return decision
  })
}
