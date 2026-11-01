/**
 * Require an exact browser Origin and a non-simple request header for session
 * mutations. Configure the canonical public origin on the server; never derive
 * it from Host or forwarded headers supplied by the request.
 *
 * Cross-origin requests with this header require a CORS preflight. Session
 * routes must not grant cross-origin CORS access or accept method overrides.
 */
export function allowsSessionMutation({ origin, expectedOrigin, contentType, requestedWith }) {
  if (typeof expectedOrigin !== 'string' || !expectedOrigin || origin !== expectedOrigin) return false
  try {
    const parsed = new URL(expectedOrigin)
    if (parsed.origin !== expectedOrigin || !['https:', 'http:'].includes(parsed.protocol)) return false
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return false
  } catch {
    return false
  }
  return typeof contentType === 'string'
    && /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType.trim())
    && requestedWith === 'IdeaMapSession'
}
