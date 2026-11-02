import type pg from 'pg'

/** Call after locking the affected ideas, in the transaction that changes their owner or history. */
export async function lockApprovalHistoryOwners(client: pg.PoolClient, ownerIds: string[]): Promise<void> {
  for (const id of [...new Set(ownerIds)].sort()) {
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id])
  }
}

/** Record the actual approved revision in the same transaction as publication. */
export async function recordApprovedSubmission(client: pg.PoolClient, ideaId: string, revisionId: string): Promise<void> {
  const idea = await client.query<{ owner_id: string | null }>('SELECT owner_id FROM ideas WHERE id = $1 FOR UPDATE', [ideaId])
  if (!idea.rowCount) throw new Error('Idea not found')
  if (idea.rows[0].owner_id) await lockApprovalHistoryOwners(client, [idea.rows[0].owner_id])
  const result = await client.query(`INSERT INTO approval_records (idea_id, revision_id, verified_for_trust)
    SELECT i.id, r.id, true FROM ideas i JOIN approved_revisions a ON a.idea_id = i.id
      JOIN idea_revisions r ON r.id = a.revision_id AND r.idea_id = i.id
    WHERE i.id = $1 AND r.id = $2 AND i.publication_state = 'approved' AND r.review_state = 'approved'
    ON CONFLICT (idea_id) DO UPDATE SET revision_id = EXCLUDED.revision_id
    RETURNING idea_id`, [ideaId, revisionId])
  if (!result.rowCount) throw new Error('Approval evidence does not match the approved revision')
}

export interface VerifiedOwnerEvidence {
  /** The caller must verify this identity and email through the server-side identity provider. */
  userId: string
  emailVerified: boolean
}

export interface TrustDecision {
  eligible: boolean
  priorApprovals: number | null
  threshold: number | null
}

/** Use only in the publication transaction after server-side identity verification. */
export async function evaluateTrustedShortcut(client: pg.PoolClient, currentIdeaId: string,
  identity: VerifiedOwnerEvidence | null, score: number): Promise<TrustDecision> {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid compliance score')
  const fallback: TrustDecision = { eligible: false, priorApprovals: null, threshold: null }
  if (!identity || identity.emailVerified !== true || !identity.userId) return fallback
  const current = await client.query<{ owner_id: string | null }>('SELECT owner_id FROM ideas WHERE id = $1 FOR UPDATE', [currentIdeaId])
  if (!current.rowCount || current.rows[0].owner_id !== identity.userId) return fallback
  await lockApprovalHistoryOwners(client, [identity.userId])
  const result = await client.query<{ total: number, unknown: number }>(`
    SELECT count(*) FILTER (WHERE a.verified_for_trust AND NOT a.excluded_for_violation)::int AS total,
      count(*) FILTER (WHERE NOT a.verified_for_trust)::int AS unknown
    FROM approval_records a JOIN ideas i ON i.id = a.idea_id
    WHERE i.owner_id = $1 AND i.id <> $2`, [identity.userId, currentIdeaId])
  if (result.rows[0].unknown) return fallback
  const priorApprovals = result.rows[0].total
  const threshold = 95 - 0.5 * Math.min(priorApprovals, 10)
  return { eligible: score > threshold, priorApprovals, threshold }
}

/** The injected verifier must enforce server-side moderator authorization. */
export async function correctApprovalEligibility(pool: pg.Pool, input: { ideaId: string, actorId: string, excluded: boolean, reason: string },
  authorize: (client: pg.PoolClient, actorId: string) => Promise<boolean>): Promise<boolean> {
  if (!input.reason.trim() || Buffer.byteLength(input.reason, 'utf8') > 1000) throw new Error('A bounded correction reason is required')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!await authorize(client, input.actorId)) throw new Error('Moderator authorization required')
    const idea = await client.query<{ owner_id: string | null }>('SELECT owner_id FROM ideas WHERE id = $1 FOR UPDATE', [input.ideaId])
    if (!idea.rowCount) throw new Error('Idea not found')
    if (idea.rows[0].owner_id) await lockApprovalHistoryOwners(client, [idea.rows[0].owner_id])
    const exists = await client.query('SELECT 1 FROM approval_records WHERE idea_id = $1', [input.ideaId])
    if (!exists.rowCount) throw new Error('Approval record not found')
    const changed = await client.query(`UPDATE approval_records SET excluded_for_violation = $2, verified_for_trust = true
      WHERE idea_id = $1 AND (excluded_for_violation <> $2 OR NOT verified_for_trust) RETURNING idea_id`, [input.ideaId, input.excluded])
    if (changed.rowCount) await client.query('INSERT INTO approval_corrections (idea_id, actor_id, excluded, reason) VALUES ($1, $2, $3, $4)',
      [input.ideaId, input.actorId, input.excluded, input.reason.trim()])
    await client.query('COMMIT')
    return changed.rowCount === 1
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
