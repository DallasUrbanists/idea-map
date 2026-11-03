import { claimVerifiedOwnership } from '@idea-map/server'
import { createError, getCookie, getHeader, setResponseHeader, setResponseStatus } from 'h3'
import { firebaseAdmin } from '../../utils/firebase-admin'
import { allowsSessionMutation } from '../../utils/session-csrf.mjs'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  if (config.ownershipClaimsEnabled !== true) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (!allowsSessionMutation({ origin: getHeader(event, 'origin'), expectedOrigin: config.sessionOrigin,
    contentType: getHeader(event, 'content-type'), requestedWith: getHeader(event, 'x-idea-map-session') })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const cookie = getCookie(event, '__session')
  if (!cookie) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 4096) tooLarge = true
    if (!tooLarge) chunks.push(bytes)
  }
  if (tooLarge) throw createError({ statusCode: 413, statusMessage: 'Request too large' })
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw createError({ statusCode: 400, statusMessage: 'Invalid request' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
      typeof (body as { ideaId?: unknown }).ideaId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((body as { ideaId: string }).ideaId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }
  if (!config.databaseUrl || !config.firebaseProjectId) throw createError({ statusCode: 503, statusMessage: 'Ownership unavailable' })
  let result: 'unauthenticated' | 'forbidden' | 'processed'
  try {
    const verifier = firebaseAdmin(config.firebaseProjectId, config.authProviderMode)
    if (verifier.app.options.projectId !== config.firebaseProjectId) throw new Error('Firebase project mismatch')
    result = await claimVerifiedOwnership(config.databaseUrl, config.firebaseProjectId, cookie, verifier, (body as { ideaId: string }).ideaId)
  } catch { throw createError({ statusCode: 503, statusMessage: 'Ownership unavailable' }) }
  if (result === 'unauthenticated') throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  if (result === 'forbidden') throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  setResponseStatus(event, 204)
  return null
})
