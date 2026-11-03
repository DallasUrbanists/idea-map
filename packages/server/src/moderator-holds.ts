import type pg from 'pg'
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

/** Lock in the publication writer's order, then check the reviewer's snapshot. */
async function lockCurrentRevision(client: pg.PoolClient, input: HoldRequest, pendingOnly = true): Promise<boolean> {
  const revision = await client.query(`SELECT r.id FROM ideas i JOIN idea_revisions r ON r.idea_id = i.id
    WHERE r.id = $1 FOR UPDATE OF i, r`, [input.revisionId])
  if (!revision.rowCount) return false
  const current = await client.query(`SELECT 1 FROM ideas i JOIN idea_revisions r ON r.idea_id = i.id
    WHERE r.id = $1 AND (NOT $3::boolean OR (i.publication_state <> 'withdrawn' AND r.review_state NOT IN ('approved', 'rejected')))
      AND NOT EXISTS (SELECT 1 FROM idea_revisions newer WHERE newer.idea_id = i.id AND newer.version > r.version)
      AND (SELECT id FROM revision_assessments WHERE revision_id = r.id AND current) IS NOT DISTINCT FROM $2::text`,
  [input.revisionId, input.assessmentId, pendingOnly])
  return !!current.rowCount
}

/** Server-only primitive. No moderator controls or permissions are enabled by this module. */
export async function placeModeratorHold(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: HoldRequest): Promise<ModeratorAccess<'placed' | 'stale' | 'already-held'>> {
  validate(input)
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, actor) => {
    if (!await lockCurrentRevision(client, input)) return 'stale'
    const created = await client.query(`INSERT INTO moderator_holds (revision_id, placed_by, reason, created_at)
      VALUES ($1, $2, $3, clock_timestamp()) ON CONFLICT (revision_id) WHERE released_at IS NULL DO NOTHING RETURNING id`,
    [input.revisionId, actor, input.reason.trim()])
    return created.rowCount ? 'placed' : 'already-held'
  })
}

/** A release resolves only the named hold and cannot clear another review block. */
export async function releaseModeratorHold(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: HoldRequest & { holdId: string }): Promise<ModeratorAccess<'released' | 'stale' | 'not-held'>> {
  validate(input)
  if (!uuid.test(input.holdId)) throw new Error('Invalid moderator hold')
  return withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, actor) => {
    if (!await lockCurrentRevision(client, input, false)) return 'stale'
    const released = await client.query(`UPDATE moderator_holds SET released_by = $3, released_at = clock_timestamp(), release_reason = $4
      WHERE id = $1 AND released_at IS NULL AND revision_id IN
        (SELECT held.id FROM idea_revisions held JOIN idea_revisions current ON current.idea_id = held.idea_id WHERE current.id = $2)
      RETURNING id`,
    [input.holdId, input.revisionId, actor, input.reason.trim()])
    return released.rowCount ? 'released' : 'not-held'
  })
}
