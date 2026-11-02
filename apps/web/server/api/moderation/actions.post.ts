import { approveModerationRevision, escalateModerationRevision, placeModeratorHold, rejectModerationRevision, releaseModeratorHold, requestModeratorChanges, resolveModeratorChanges, transferModeratorEscalation } from '@idea-map/server'
import { createError, getCookie, getHeader, setResponseHeader, setResponseStatus } from 'h3'
import { firebaseAdmin } from '../../utils/firebase-admin'
import { allowsSessionMutation } from '../../utils/session-csrf.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Action = { action: 'approve' | 'reject' | 'request-changes' | 'resolve-changes' | 'place-hold' | 'release-hold' | 'escalate' | 'transfer-escalation', revisionId: string, assessmentId: string | null, reason: string, requestId?: string, holdId?: string, ownerId?: string, expectedSequence?: number }
function parseAction(body: unknown): Action | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = body as Record<string, unknown>
  if (typeof value.action !== 'string' || !['approve', 'reject', 'request-changes', 'resolve-changes', 'place-hold', 'release-hold', 'escalate', 'transfer-escalation'].includes(value.action)) return null
  const fields = ['action', 'revisionId', 'assessmentId', 'reason']
  if (value.action === 'resolve-changes') fields.push('requestId')
  if (value.action === 'release-hold') fields.push('holdId')
  if (value.action === 'escalate') fields.push('ownerId')
  if (value.action === 'transfer-escalation') fields.push('holdId', 'ownerId', 'expectedSequence')
  if (Object.keys(value).length !== fields.length || !fields.every(field => Object.hasOwn(value, field)) ||
      typeof value.revisionId !== 'string' || !uuid.test(value.revisionId) ||
      (value.assessmentId !== null && (typeof value.assessmentId !== 'string' || !value.assessmentId || Buffer.byteLength(value.assessmentId) > 200)) ||
      typeof value.reason !== 'string' || !value.reason.trim() || Buffer.byteLength(value.reason) > 1000 || /[\x00-\x1f\x7f]/u.test(value.reason) ||
      (value.action === 'resolve-changes' && (typeof value.requestId !== 'string' || !uuid.test(value.requestId))) ||
      (['release-hold', 'transfer-escalation'].includes(value.action) && (typeof value.holdId !== 'string' || !uuid.test(value.holdId))) ||
      (['escalate', 'transfer-escalation'].includes(value.action) && (typeof value.ownerId !== 'string' || !uuid.test(value.ownerId))) ||
      (value.action === 'transfer-escalation' && (typeof value.expectedSequence !== 'number' || !Number.isSafeInteger(value.expectedSequence) || value.expectedSequence < 0 || value.expectedSequence >= 2147483647))) return null
  return value as Action
}

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  if (config.moderationActionsEnabled !== true) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (!allowsSessionMutation({ origin: getHeader(event, 'origin'), expectedOrigin: config.sessionOrigin,
    contentType: getHeader(event, 'content-type'), requestedWith: getHeader(event, 'x-idea-map-session') })) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  const cookie = getCookie(event, '__session')
  if (!cookie) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size <= 4096) chunks.push(bytes)
  }
  if (size > 4096) throw createError({ statusCode: 413, statusMessage: 'Request too large' })
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw createError({ statusCode: 400, statusMessage: 'Invalid request' }) }
  const input = parseAction(body)
  if (!input) throw createError({ statusCode: 400, statusMessage: 'Invalid request' })
  if (!config.databaseUrl || !config.firebaseProjectId) throw createError({ statusCode: 503, statusMessage: 'Moderation unavailable' })
  let result: { state: 'unauthenticated' | 'forbidden' } | { state: 'authorized', value: string }
  try {
    const verifier = firebaseAdmin(config.firebaseProjectId)
    if (verifier.app.options.projectId !== config.firebaseProjectId) throw new Error('Firebase project mismatch')
    const args = [config.databaseUrl, config.firebaseProjectId, cookie, verifier] as const
    const decision = { revisionId: input.revisionId, assessmentId: input.assessmentId, reason: input.reason }
    if (input.action === 'approve') result = await approveModerationRevision(...args, decision)
    else if (input.action === 'reject') result = await rejectModerationRevision(...args, decision)
    else if (input.action === 'request-changes') result = await requestModeratorChanges(...args, decision)
    else if (input.action === 'resolve-changes') result = await resolveModeratorChanges(...args, { ...decision, requestId: input.requestId! })
    else if (input.action === 'place-hold') result = await placeModeratorHold(...args, decision)
    else if (input.action === 'release-hold') result = await releaseModeratorHold(...args, { ...decision, holdId: input.holdId! })
    else if (input.action === 'escalate') result = await escalateModerationRevision(...args, { ...decision, ownerId: input.ownerId! })
    else result = await transferModeratorEscalation(...args, { ...decision, holdId: input.holdId!, ownerId: input.ownerId!, expectedSequence: input.expectedSequence! })
  } catch { throw createError({ statusCode: 503, statusMessage: 'Moderation unavailable' }) }
  if (result.state !== 'authorized') {
    if (result.state === 'unauthenticated') throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  if (['stale', 'blocked', 'already-requested', 'not-requested', 'already-held', 'not-held', 'already-escalated', 'owner-unavailable', 'not-active', 'unchanged'].includes(result.value)) setResponseStatus(event, 409)
  return { outcome: result.value }
})
