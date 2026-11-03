import { listModeratorOwners } from '@idea-map/server'
import { createError, getCookie, setResponseHeader } from 'h3'
import { firebaseAdmin } from '../../utils/firebase-admin'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  if (config.moderationReviewEnabled !== true) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const cookie = getCookie(event, '__session')
  if (!cookie) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  if (!config.databaseUrl || !config.firebaseProjectId) throw createError({ statusCode: 503, statusMessage: 'Moderation unavailable' })
  let result: Awaited<ReturnType<typeof listModeratorOwners>>
  try {
    const verifier = firebaseAdmin(config.firebaseProjectId)
    if (verifier.app.options.projectId !== config.firebaseProjectId) throw new Error('Firebase project mismatch')
    result = await listModeratorOwners(config.databaseUrl, config.firebaseProjectId, cookie, verifier)
  } catch { throw createError({ statusCode: 503, statusMessage: 'Moderation unavailable' }) }
  if (result.state !== 'authorized') {
    if (result.state === 'unauthenticated') throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return { moderators: result.value }
})
