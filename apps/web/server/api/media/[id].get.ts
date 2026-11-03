import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { getMediaPreview, MAX_MEDIA_PREVIEW_BYTES, type PublicAccessLease } from '@idea-map/server'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  const config = useRuntimeConfig(event)
  const lease = event.context.publicAccessLease as PublicAccessLease | undefined
  const maxBytes = Number(config.mediaPreviewMaxBytes)
  if (!lease || lease.signal.aborted || !config.databaseUrl || !config.approvedMediaBucket || !config.pendingMediaBucket ||
      config.approvedMediaBucket === config.pendingMediaBucket || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_MEDIA_PREVIEW_BYTES) {
    throw createError({ statusCode: 503, statusMessage: 'Preview unavailable' })
  }
  try {
    const preview = await getMediaPreview(config.databaseUrl, config.approvedMediaBucket, id, maxBytes, config.mediaProviderMode, lease.client, lease.signal)
    if (!preview) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    setResponseHeader(event, 'Content-Type', preview.contentType)
    return preview.bytes
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404) throw error
    throw createError({ statusCode: 503, statusMessage: 'Preview unavailable' })
  }
})
