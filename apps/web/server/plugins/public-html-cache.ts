export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response) => {
    const headers = response.headers || {}
    const cacheKey = Object.keys(headers).find(key => key.toLowerCase() === 'cache-control') || 'cache-control'
    // Nuxt supplies its own cache header on rendered pages. Shared copies could
    // bypass the public-access gate after a removal or journal failure.
    headers[cacheKey] = 'private, no-store'
    response.headers = headers
  })
})
