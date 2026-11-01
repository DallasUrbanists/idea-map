import { createError, defineEventHandler, getHeader, setResponseHeader } from 'h3'

// No mutation is available until a server-side identity and authorization policy
// is implemented. This runs before routes, including routes added in the future.
export default defineEventHandler((event) => {
  const method = event.method.toUpperCase()
  const hasMethodOverride = ['x-http-method-override', 'x-http-method', 'x-method-override']
    .some(header => getHeader(event, header) !== undefined)

  // Only the session endpoint may mutate; it enforces its own Origin and CSRF checks.
  const sessionPost = method === 'POST' && event.path.split('?')[0] === '/api/session'
  if (((method !== 'GET' && method !== 'HEAD') && !sessionPost) || hasMethodOverride) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    throw createError({ statusCode: 403, statusMessage: 'Mutations unavailable' })
  }
})
