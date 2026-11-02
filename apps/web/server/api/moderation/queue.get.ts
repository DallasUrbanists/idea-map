import { listModeratorQueue, validModeratorQueueCursor } from '@idea-map/server'
import { createError, getCookie, getQuery, setResponseHeader } from 'h3'
import { firebaseAdmin } from '../../utils/firebase-admin'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  if (config.moderationReviewEnabled !== true) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const query = getQuery(event)
  if (Object.keys(query).some(key => !['after', 'at'].includes(key)) ||
      (query.after === undefined) !== (query.at === undefined) ||
      (query.after !== undefined && (typeof query.after !== 'string' || typeof query.at !== 'string' ||
        !validModeratorQueueCursor({ revisionId: query.after, createdAt: query.at })))) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }
  const cookie = getCookie(event, '__session')
  if (!cookie) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  if (!config.databaseUrl || !config.firebaseProjectId) throw createError({ statusCode: 503, statusMessage: 'Moderation unavailable' })
  let result: Awaited<ReturnType<typeof listModeratorQueue>>
  try {
    const verifier = firebaseAdmin(config.firebaseProjectId)
    if (verifier.app.options.projectId !== config.firebaseProjectId) throw new Error('Firebase project mismatch')
    const cursor = typeof query.after === 'string' && typeof query.at === 'string' ? { revisionId: query.after, createdAt: query.at } : null
    result = await listModeratorQueue(config.databaseUrl, config.firebaseProjectId, cookie, verifier, cursor)
  } catch { throw createError({ statusCode: 503, statusMessage: 'Moderation unavailable' }) }
  if (result.state !== 'authorized') {
    if (result.state === 'unauthenticated') throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return result.value
})
