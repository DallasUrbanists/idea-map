import { Readable } from 'node:stream'
import type { Storage } from '@google-cloud/storage'

/** Accept only an explicit loopback endpoint for local preview fixtures. */
export function validateLocalPreviewEndpoint(endpoint: string): void {
  let url: URL
  try { url = new URL(endpoint) } catch { throw new Error('Offline previews require a local storage emulator') }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || Number(url.port) < 1 ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Offline previews require a local storage emulator')
}

/** Minimal local-only adapter for the existing exact-generation preview interface. */
export function createOfflinePreviewStorage(endpoint: string): Storage {
  validateLocalPreviewEndpoint(endpoint)
  function objectFile(bucket: string, object: string, options: { preconditionOpts: { ifGenerationMatch: string } }) {
    const generation = options.preconditionOpts.ifGenerationMatch
    if ([bucket, object].some(value => !value || value === '.' || value === '..')) throw new Error('Invalid local preview object')
    const url = new URL(`/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`, endpoint)
    url.searchParams.set('generation', generation)
    url.searchParams.set('ifGenerationMatch', generation)
    const request = async (media: boolean) => {
      const target = new URL(url)
      if (media) target.searchParams.set('alt', 'media')
      // Never follow a fake's redirect to a hosted provider or another origin.
      const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error('Local preview storage unavailable')
      return response
    }
    return {
      // exactGenerationFile injects the same generation values into SDK requests.
      interceptors: [],
      async getMetadata() {
        const body = (await request(false)).body
        if (!body) throw new Error('Local preview storage returned no metadata')
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of body) {
          const bytes = Buffer.from(chunk)
          size += bytes.length
          if (size > 64 * 1024) throw new Error('Local preview metadata is too large')
          chunks.push(bytes)
        }
        return [JSON.parse(Buffer.concat(chunks).toString('utf8'))]
      },
      createReadStream() {
        return Readable.from((async function* () {
          const body = (await request(true)).body
          if (!body) throw new Error('Local preview storage returned no body')
          for await (const chunk of body) yield chunk
        })())
      },
    }
  }
  return { bucket: (bucket: string) => ({ file: (object: string, options: { preconditionOpts: { ifGenerationMatch: string } }) => objectFile(bucket, object, options) }) } as unknown as Storage
}
