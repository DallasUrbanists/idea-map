import { AsyncLocalStorage } from 'node:async_hooks'
import type { PublicAccessLease } from '@idea-map/server'

// Only server-created nested fetches can inherit this value; request headers
// are never interpreted as proof that a lease exists.
export const publicAccessContext = new AsyncLocalStorage<PublicAccessLease>()
