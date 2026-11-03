import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { acquirePublicAccessLeaseForDatabase } from '@idea-map/server'
import { publicAccessContext } from '../utils/public-access-context'

const protectedApi = /^\/api\/(?:ideas|media)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i

/** Keep the outer response guarded through delivery, including nested SSR fetches. */
export default defineEventHandler(async event => {
  let path = event.path.split('?')[0] ?? ''
  try { path = decodeURIComponent(path) }
  catch { throw createError({ statusCode: 400, statusMessage: 'Invalid request path' }) }
  if (!['GET', 'HEAD'].includes(event.method.toUpperCase()) ||
      (!/^\/suggestion(?:\/|$)/i.test(path) && !protectedApi.test(path))) return
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const inherited = publicAccessContext.getStore()
  if (inherited) {
    if (inherited.signal.aborted) throw createError({ statusCode: 503, statusMessage: 'Public access unavailable' })
    event.context.publicAccessLease = inherited
    return
  }
  let lease
  try { lease = await acquirePublicAccessLeaseForDatabase(useRuntimeConfig(event).databaseUrl) }
  catch { throw createError({ statusCode: 503, statusMessage: 'Public access unavailable' }) }
  const response = event.node.res
  if (response.destroyed || lease.signal.aborted) {
    await lease.release().catch(() => {})
    throw createError({ statusCode: 503, statusMessage: 'Public access unavailable' })
  }
  event.context.publicAccessLease = lease
  const fetch = event.$fetch
  event.$fetch = ((...args: Parameters<typeof fetch>) => publicAccessContext.run(lease, () => fetch(...args))) as typeof fetch
  const abort = () => response.destroy()
  const release = () => {
    response.removeListener('finish', release)
    response.removeListener('close', release)
    lease.signal.removeEventListener('abort', abort)
    void lease.release().catch(() => console.error('Public access guard cleanup failed'))
  }
  lease.signal.addEventListener('abort', abort, { once: true })
  response.once('finish', release)
  response.once('close', release)
})
