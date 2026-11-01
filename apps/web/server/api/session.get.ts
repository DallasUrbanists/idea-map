import { getCookie, setResponseHeader } from 'h3'
import { firebaseAdmin } from '../utils/firebase-admin'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const cookie = getCookie(event, '__session')
  const projectId = useRuntimeConfig(event).firebaseProjectId
  if (!cookie || !projectId) return { registered: false }
  try {
    const identity = await firebaseAdmin(projectId).verifySessionCookie(cookie, true)
    const provider = identity.firebase?.sign_in_provider
    if (!identity.uid || !provider || provider === 'anonymous') return { registered: false }
    return { registered: true, emailVerified: identity.email_verified === true }
  } catch {
    return { registered: false }
  }
})
