import { createError, defineEventHandler, getHeader, setCookie, setResponseHeader } from 'h3'
import { allowsSessionMutation } from '../utils/session-csrf.mjs'
import { issueSession, SESSION_LIFETIME_MS } from '../utils/session-policy.mjs'
import { firebaseAdmin } from '../utils/firebase-admin'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  if (!allowsSessionMutation({
    origin: getHeader(event, 'origin'), expectedOrigin: config.sessionOrigin,
    contentType: getHeader(event, 'content-type'), requestedWith: getHeader(event, 'x-idea-map-session'),
  })) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })

  // Bound memory even for chunked requests without a Content-Length header.
  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 32768) tooLarge = true
    if (!tooLarge) chunks.push(bytes)
  }
  if (tooLarge) throw createError({ statusCode: 413, statusMessage: 'Request too large' })
  let body: { action?: unknown, idToken?: unknown }
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw createError({ statusCode: 400, statusMessage: 'Invalid request' }) }
  const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' }
  if (body?.action === 'logout') {
    setCookie(event, '__session', '', { ...cookieOptions, maxAge: 0 })
    return { ok: true }
  }
  if (body?.action !== 'login' || typeof body.idToken !== 'string' || body.idToken.length > 16384) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }
  if (!config.firebaseProjectId) throw createError({ statusCode: 503, statusMessage: 'Authentication unavailable' })
  try {
    const cookie = await issueSession({ idToken: body.idToken, provider: firebaseAdmin(config.firebaseProjectId) })
    setCookie(event, '__session', cookie, { ...cookieOptions, maxAge: SESSION_LIFETIME_MS / 1000 })
    return { ok: true }
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Authentication failed' })
  }
})
