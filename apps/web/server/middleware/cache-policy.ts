import { defineEventHandler, setResponseHeader } from 'h3'

// Default to no storage, including for errors and routes added later.
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  // Nitro's error handler overwrites 404 headers after middleware and bypasses
  // its response hook. Enforce no-store at the Node server's final header write.
  const res = event.node.res
  const writeHead = res.writeHead
  res.writeHead = function (statusCode: number, ...args: any[]) {
    if (statusCode >= 400) {
      this.setHeader('Cache-Control', 'private, no-store')
      const headers = args.at(-1)
      if (Array.isArray(headers)) {
        for (let i = headers.length - 2; i >= 0; i -= 2) {
          if (String(headers[i]).toLowerCase() === 'cache-control') headers.splice(i, 2)
        }
      } else if (headers && typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'cache-control') delete headers[key]
        }
      }
    }
    return Reflect.apply(writeHead, this, [statusCode, ...args])
  } as typeof res.writeHead
})
