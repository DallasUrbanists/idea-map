import { verifyGuestEmail } from '@idea-map/server'
import { createError, getHeader, setResponseHeader } from 'h3'
import { allowsSessionMutation } from '../../utils/session-csrf.mjs'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  if (config.guestVerificationEnabled !== true) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (!allowsSessionMutation({ origin: getHeader(event, 'origin'), expectedOrigin: config.sessionOrigin,
    contentType: getHeader(event, 'content-type'), requestedWith: getHeader(event, 'x-idea-map-session') })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size <= 1024) chunks.push(bytes)
  }
  if (size > 1024) throw createError({ statusCode: 413, statusMessage: 'Request too large' })
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw createError({ statusCode: 400, statusMessage: 'Invalid request' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
      typeof (body as { token?: unknown }).token !== 'string' || !(body as { token: string }).token || (body as { token: string }).token.length > 160) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  }
  const encodedKey = config.guestVerificationKey
  if (!config.databaseUrl || typeof encodedKey !== 'string' || !/^[A-Za-z0-9_-]{43,171}$/.test(encodedKey)) {
    throw createError({ statusCode: 503, statusMessage: 'Verification unavailable' })
  }
  const key = Buffer.from(encodedKey, 'base64url')
  if (key.length < 32 || key.length > 128 || key.toString('base64url') !== encodedKey) throw createError({ statusCode: 503, statusMessage: 'Verification unavailable' })
  try {
    const verified = await verifyGuestEmail(config.databaseUrl, (body as { token: string }).token, key)
    return { verified }
  } catch { throw createError({ statusCode: 503, statusMessage: 'Verification unavailable' }) }
})
