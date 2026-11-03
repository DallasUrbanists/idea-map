import { createError, getCookie, setResponseHeader } from 'h3'
import { firebaseAdmin } from '../utils/firebase-admin'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const cookie = getCookie(event, '__session')
  const config = useRuntimeConfig(event)
  const projectId = config.firebaseProjectId
  if (!cookie) return { registered: false }
  if (!projectId) throw createError({ statusCode: 503, statusMessage: 'Authentication unavailable' })
  let auth
  try { auth = firebaseAdmin(projectId, config.authProviderMode) }
  catch { throw createError({ statusCode: 503, statusMessage: 'Authentication unavailable' }) }
  try {
    const identity = await auth.verifySessionCookie(cookie, true)
    const provider = identity.firebase?.sign_in_provider
    if (!identity.uid || !provider || provider === 'anonymous') return { registered: false }
    return { registered: true, emailVerified: identity.email_verified === true }
  } catch {
    return { registered: false }
  }
})
