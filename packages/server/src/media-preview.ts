import { Storage } from '@google-cloud/storage'
import pg from 'pg'
import { exactGenerationFile } from './storage-generation.js'

export interface PublicPreview { readonly bytes: Buffer; readonly contentType: string }
export const MAX_MEDIA_PREVIEW_BYTES = 16 * 1024 * 1024
const pools = new Map<string, pg.Pool>()
let defaultStorage: Storage | undefined

const query = `
  SELECT preview.object_name, preview.generation, preview.content_type
  FROM media_previews AS preview
  JOIN ideas AS idea ON idea.id = preview.idea_id AND idea.publication_state = 'approved'
  JOIN approved_revisions AS approved ON approved.idea_id = preview.idea_id AND approved.revision_id = preview.revision_id
  JOIN idea_revisions AS revision ON revision.id = preview.revision_id AND revision.idea_id = preview.idea_id AND revision.review_state = 'approved'
  WHERE preview.id = $1 AND preview.published = true
  LIMIT 1
`

function matchesImage(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (contentType === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  return false
}

/** Read an authorized generation from the approved bucket, never a pending upload. */
export async function readMediaPreview(
  pool: pg.Pool, storage: Storage, bucket: string, previewId: string, maxBytes: number,
): Promise<PublicPreview | null> {
  if (!bucket || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_MEDIA_PREVIEW_BYTES) throw new Error('Invalid preview configuration')
  const first = await pool.query<{ object_name: string; generation: string; content_type: string }>(query, [previewId])
  const row = first.rows[0]
  if (!row) return null
  if (!/^[1-9][0-9]*$/.test(row.generation) || !['image/jpeg', 'image/png', 'image/webp'].includes(row.content_type)) throw new Error('Invalid preview metadata')
  const file = exactGenerationFile(storage, bucket, row.object_name, row.generation)
  const [metadata] = await file.getMetadata()
  const size = Number(metadata.size)
  if (metadata.generation !== row.generation || !Number.isSafeInteger(size) || size < 1 || size > maxBytes || metadata.contentType !== row.content_type ||
      (metadata.contentEncoding && metadata.contentEncoding !== 'identity')) throw new Error('Invalid preview object')
  const chunks: Buffer[] = []
  let count = 0
  for await (const chunk of file.createReadStream({ decompress: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    count += bytes.length
    if (count > maxBytes) throw new Error('Preview too large')
    chunks.push(bytes)
  }
  const body = Buffer.concat(chunks)
  if (count !== size || !matchesImage(body, row.content_type)) throw new Error('Invalid preview content')
  // Recheck after I/O so withdrawal or revision replacement during download fails closed.
  const current = (await pool.query<{ object_name: string; generation: string; content_type: string }>(query, [previewId])).rows[0]
  if (!current || current.object_name !== row.object_name || current.generation !== row.generation || current.content_type !== row.content_type) return null
  return { bytes: body, contentType: row.content_type }
}

/** Use a bounded shared database pool and application-default storage credentials. */
export async function getMediaPreview(databaseUrl: string, bucket: string, previewId: string, maxBytes: number): Promise<PublicPreview | null> {
  let pool = pools.get(databaseUrl)
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 })
    pool.on('error', () => console.error('Unexpected error on idle preview database client'))
    pools.set(databaseUrl, pool)
  }
  defaultStorage ??= new Storage()
  return readMediaPreview(pool, defaultStorage, bucket, previewId, maxBytes)
}
