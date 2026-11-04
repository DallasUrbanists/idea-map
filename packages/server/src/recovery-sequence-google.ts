import { GoogleAuth } from 'google-auth-library'
import type { RecoverySequenceTransport } from './recovery-sequence-storage.js'

type TokenProvider = Pick<GoogleAuth, 'getAccessToken'>
const parent = 'projects/[1-9][0-9]{5,19}/secrets/[a-zA-Z0-9_-]{1,255}'
const appendPath = new RegExp(`^${parent}:addVersion$`)
const accessPath = new RegExp(`^${parent}/versions/([1-9][0-9]{0,4}):access$`)

/** Unwired Secret Manager transport; callers must separately review effective IAM. */
export function createGoogleRecoverySequenceTransport(
  auth: TokenProvider = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
  fetcher: typeof fetch = fetch,
): RecoverySequenceTransport {
  return { async request(method, path, body, signal) {
    const match = accessPath.exec(path)
    if ((method === 'POST' && !appendPath.test(path)) ||
        (method === 'GET' && (!match || Number(match[1]) > 10_000 || body !== null)) ||
        !['POST', 'GET'].includes(method)) throw new Error('Invalid recovery sequence request')
    let encoded: string | undefined
    if (method === 'POST') {
      try { encoded = JSON.stringify(body) } catch { throw new Error('Invalid recovery sequence request') }
      if (!encoded || Buffer.byteLength(encoded) > 65_536) throw new Error('Invalid recovery sequence request')
    }
    try {
      if (signal.aborted) throw new Error('Request aborted')
      const token = await auth.getAccessToken()
      // Credential acquisition may finish after the caller's deadline.
      if (!token || signal.aborted) throw new Error('Request unavailable')
      const response = await fetcher(`https://secretmanager.googleapis.com/v1/${path}`, { method, signal,
        redirect: 'error', cache: 'no-store', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(encoded === undefined ? {} : { body: encoded }) })
      if (!response.ok) {
        if (response.body) void response.body.cancel().catch(() => {})
        return { status: response.status, data: null }
      }
      if (!response.body) throw new Error('Empty response')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          total += part.value.byteLength
          if (total > 65_536) throw new Error('Response too large')
          chunks.push(part.value)
        }
      } catch (error) {
        void reader.cancel().catch(() => {})
        throw error
      } finally { reader.releaseLock() }
      const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      return { status: response.status, data }
    } catch { throw new Error('Recovery sequence transport unavailable') }
  } }
}
