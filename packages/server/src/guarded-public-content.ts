import { getMediaPreview, type PublicPreview } from './media-preview.js'
import { readPublishedIdea, type PublicIdea } from './published-ideas.js'
import { publicAccessLeaseClient, type PublicAccessLease } from './public-access-lease.js'

/** Keep public projection reads on the caller's live access lease. */
export async function readGuardedPublishedIdea(id: string, lease: PublicAccessLease | undefined): Promise<PublicIdea | null> {
  const client = publicAccessLeaseClient(lease)
  const result = await readPublishedIdea('', id, client)
  publicAccessLeaseClient(lease)
  return result
}

/** Keep preview metadata and object reads on the caller's live access lease. */
export async function getGuardedMediaPreview(bucket: string, previewId: string, maxBytes: number, mode: string,
  lease: PublicAccessLease | undefined): Promise<PublicPreview | null> {
  const client = publicAccessLeaseClient(lease)
  const result = await getMediaPreview('', bucket, previewId, maxBytes, mode, client, lease!.signal)
  publicAccessLeaseClient(lease)
  return result
}
