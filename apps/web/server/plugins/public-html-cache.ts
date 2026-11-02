import { getHeader, getResponseHeader, getResponseStatus } from 'h3'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response, { event }) => {
    const headers = response.headers || {}
    const status = response.statusCode || getResponseStatus(event)
    const hasSetCookie = Object.keys(headers).some(key => key.toLowerCase() === 'set-cookie') ||
      getResponseHeader(event, 'set-cookie') !== undefined
    const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
    const cacheKey = Object.keys(headers).find(key => key.toLowerCase() === 'cache-control') || 'cache-control'
    // Nuxt supplies its own cache header on rendered pages; override it by default.
    headers[cacheKey] = 'private, no-store'
    if (event.context.publicIdeaHtml === true && status === 200 && !event.context.nitro?.errors?.length &&
        (event.method === 'GET' || event.method === 'HEAD') &&
        getHeader(event, 'cookie') === undefined && getHeader(event, 'authorization') === undefined &&
        !hasSetCookie && typeof contentType === 'string' && contentType.toLowerCase().includes('text/html')) {
      headers[cacheKey] = 'public, max-age=0, s-maxage=60, must-revalidate'
      // Retain any renderer-provided Vary values; Hosting also varies on these headers.
      const varyKey = Object.keys(headers).find(key => key.toLowerCase() === 'vary')
      headers[varyKey || 'vary'] = [varyKey ? headers[varyKey] : '', 'Cookie', 'Authorization'].filter(Boolean).join(', ')
    }
    response.headers = headers
  })
})
