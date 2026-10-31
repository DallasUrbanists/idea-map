import pg from 'pg'

export interface PublicIdea { readonly title: string; readonly description: string }
const pools = new Map<string, pg.Pool>()

/** Read only the approved public projection. No contact or owner columns are selected. */
export async function readPublishedIdea(databaseUrl: string, id: string): Promise<PublicIdea | null> {
  let pool = pools.get(databaseUrl)
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 })
    pool.on('error', (error) => {
      console.error('Unexpected error on idle PostgreSQL client', error)
    })
    pools.set(databaseUrl, pool)
  }
  const result = await pool.query<{ title: string | null; description: string | null }>(`
    SELECT revision.content->>'title' AS title, revision.content->>'description' AS description
    FROM ideas AS idea
    JOIN approved_revisions AS approved ON approved.idea_id = idea.id
    JOIN idea_revisions AS revision ON revision.idea_id = approved.idea_id AND revision.id = approved.revision_id
    WHERE idea.id = $1 AND idea.publication_state = 'approved' AND revision.review_state = 'approved'
    LIMIT 1
  `, [id])
  const row = result.rows[0]
  if (!row || typeof row.title !== 'string' || typeof row.description !== 'string' || !row.title.trim() || !row.description.trim()) return null
  return { title: row.title, description: row.description }
}

