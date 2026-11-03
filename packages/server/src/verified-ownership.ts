import { runtimeDatabasePool } from './runtime-database.js'
import { verifyRegisteredSession, type RegisteredSessionVerifier } from './moderator-authorization.js'

/** Preserve the local part and normalize only the ASCII domain; never infer provider aliases. */
export function normalizeOwnershipEmail(email: string): string | null {
  if (typeof email !== 'string' || Buffer.byteLength(email, 'utf8') > 254 || /[\s\x00-\x1f\x7f]/u.test(email)) return null
  const parts = email.split('@')
  if (parts.length !== 2 || !parts[0] || Buffer.byteLength(parts[0], 'utf8') > 64 || !parts[1] || parts[1].length > 253) return null
  const labels = parts[1].toLowerCase().split('.')
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
  return `${parts[0]}@${labels.join('.')}`
}

/** Only call with the configured Firebase Admin verifier; this does not grant publication. */
export async function claimVerifiedOwnership(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, ideaId: string): Promise<'unauthenticated' | 'forbidden' | 'processed'> {
  if (!databaseUrl || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ideaId)) throw new Error('Invalid ownership request')
  const session = await verifyRegisteredSession(projectId, cookie, verifier)
  if (session.state !== 'verified') return session.state
  const email = normalizeOwnershipEmail(session.email)
  if (!email) return 'forbidden'
  const client = await runtimeDatabasePool(databaseUrl).connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    await client.query('SELECT public.claim_verified_idea($1,$2,$3,$4)',
      [`firebase:${projectId}`, session.uid, email, ideaId])
    // A queued claim may wait for database locks; recheck the account before commit.
    let timer: ReturnType<typeof setTimeout> | undefined
    let current
    try {
      current = await Promise.race([
        verifyRegisteredSession(projectId, cookie, verifier),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Identity recheck timed out')), 5000) }),
      ])
    } finally { if (timer) clearTimeout(timer) }
    if (current.state !== 'verified' || current.uid !== session.uid || current.email !== session.email) {
      await client.query('ROLLBACK')
      return current.state === 'unauthenticated' ? 'unauthenticated' : 'forbidden'
    }
    await client.query('COMMIT')
    // Conceal whether the idea exists, is already owned, or matches this email.
    return 'processed'
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
