import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3'

// No mutation is available until a server-side identity and authorization policy
// is implemented. This runs before routes, including routes added in the future.
export default defineEventHandler((event) => {
  const method = event.method.toUpperCase()
  const path = event.path.split('?')[0]
  const config = useRuntimeConfig(event)
  const hasMethodOverride = ['x-http-method-override', 'x-http-method', 'x-method-override']
    .some(header => getHeader(event, header) !== undefined)

  // Each exception authenticates and authorizes its own requests.
  const sessionPost = method === 'POST' && path === '/api/session'
  const webhookPost = method === 'POST' && path === '/api/webhooks/resend'
  const ownershipPost = method === 'POST' && path === '/api/ownership/claim' && config.ownershipClaimsEnabled === true
  const removalPost = method === 'POST' && path === '/api/moderation/removal' && config.journaledRemoval.enabled === true
  const holdPost = method === 'POST' && path === '/api/moderation/legal-hold' && config.journaledRemoval.holdPlacementEnabled === true
  const healthGet = method === 'GET' && path === '/api/health'
  if (config.stagingWebhookOnly && !webhookPost && !healthGet) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  if (((method !== 'GET' && method !== 'HEAD') && !sessionPost && !webhookPost && !ownershipPost && !removalPost && !holdPost) || hasMethodOverride) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    throw createError({ statusCode: 403, statusMessage: 'Mutations unavailable' })
  }
})
