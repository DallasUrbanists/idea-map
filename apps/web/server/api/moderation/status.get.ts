import { withVerifiedModerator } from '@idea-map/server'
import { createError, getCookie, setResponseHeader } from 'h3'
import { firebaseAdmin } from '../../utils/firebase-admin'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const { databaseUrl, firebaseProjectId } = useRuntimeConfig(event)
  if (!databaseUrl || !firebaseProjectId) throw createError({ statusCode: 503, statusMessage: 'Moderation unavailable' })
  const cookie = getCookie(event, '__session')
  if (!cookie) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  try {
    const verifier = firebaseAdmin(firebaseProjectId)
    if (verifier.app.options.projectId !== firebaseProjectId) throw new Error('Firebase project mismatch')
    const authorized = await withVerifiedModerator(databaseUrl, firebaseProjectId, cookie, verifier, async () => true)
    if (authorized.state === 'authorized') return { moderator: true }
    if (authorized.state === 'unauthenticated') throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 401) throw error
    throw createError({ statusCode: 503, statusMessage: 'Moderation unavailable' })
  }
  throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
})
