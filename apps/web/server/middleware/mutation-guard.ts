import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3'

// No mutation is available until a server-side identity and authorization policy
// is implemented. This runs before routes, including routes added in the future.
export default defineEventHandler((event) => {
  const method = event.method.toUpperCase()
  const hasMethodOverride = ['x-http-method-override', 'x-http-method', 'x-method-override']
    .some(header => getHeader(event, header) !== undefined)

  // Each exception authenticates and authorizes its own requests.
  const sessionPost = method === 'POST' && event.path.split('?')[0] === '/api/session'
  const webhookPost = method === 'POST' && event.path.split('?')[0] === '/api/webhooks/resend'
  const healthGet = method === 'GET' && event.path.split('?')[0] === '/api/health'
  if (useRuntimeConfig(event).stagingWebhookOnly && !webhookPost && !healthGet) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
  if (((method !== 'GET' && method !== 'HEAD') && !sessionPost && !webhookPost) || hasMethodOverride) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    throw createError({ statusCode: 403, statusMessage: 'Mutations unavailable' })
  }
})
