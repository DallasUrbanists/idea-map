import type pg from 'pg'
import { runtimeDatabasePool } from './runtime-database.js'

interface VerifiedSession {
  uid: string
  email?: string
  email_verified?: boolean
  firebase?: { sign_in_provider?: string }
}

/** The verifier must be the configured Firebase Admin SDK, not client claims. */
export interface RegisteredSessionVerifier {
  verifySessionCookie(cookie: string, checkRevoked: boolean): Promise<VerifiedSession>
  getUser(uid: string): Promise<{ uid: string, email?: string, emailVerified: boolean, disabled: boolean }>
}
export type ModeratorSessionVerifier = RegisteredSessionVerifier

export type ModeratorAccess<T> =
  | { state: 'unauthenticated' | 'forbidden' }
  | { state: 'authorized', value: T }

export type RegisteredSession =
  | { state: 'unauthenticated' | 'forbidden' }
  | { state: 'verified', uid: string, email: string }

/** Read verified identity and current account data from the server-side provider. */
export async function verifyRegisteredSession(projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier): Promise<RegisteredSession> {
  if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(projectId)) throw new Error('Invalid identity configuration')
  if (!cookie || cookie.length > 16384) return { state: 'unauthenticated' }
  let session: VerifiedSession
  try {
    session = await verifier.verifySessionCookie(cookie, true)
    if (!session.uid || session.uid.length > 128 || !session.firebase?.sign_in_provider ||
        session.firebase.sign_in_provider === 'anonymous') return { state: 'unauthenticated' }
    if (session.email_verified !== true || !session.email) return { state: 'forbidden' }
    const current = await verifier.getUser(session.uid)
    if (current.uid !== session.uid || current.disabled !== false) return { state: 'unauthenticated' }
    if (current.emailVerified !== true || current.email !== session.email) return { state: 'forbidden' }
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (['auth/argument-error', 'auth/invalid-session-cookie', 'auth/session-cookie-expired',
      'auth/session-cookie-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(String(code))) return { state: 'unauthenticated' }
    throw new Error('Identity verification unavailable')
  }
  return { state: 'verified', uid: session.uid, email: session.email! }
}

/** Verify a current registered identity, then hold its database role lock through the action. */
export async function withVerifiedModerator<T>(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, action: (client: pg.PoolClient, userId: string, subject: string) => Promise<T>): Promise<ModeratorAccess<T>> {
  if (!databaseUrl) throw new Error('Invalid moderator configuration')
  const session = await verifyRegisteredSession(projectId, cookie, verifier)
  if (session.state !== 'verified') return session
  const client = await runtimeDatabasePool(databaseUrl).connect()
  try {
    // Review actions recheck the current revision after waiting for its lock.
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    const result = await client.query<{ user_id: string | null }>(
      'SELECT public.lock_active_moderator($1, $2) AS user_id', [`firebase:${projectId}`, session.uid])
    const userId = result.rows[0]?.user_id
    if (!userId) { await client.query('ROLLBACK'); return { state: 'forbidden' } }
    const value = await action(client, userId, session.uid)
    // A review action may wait on database locks. Recheck the provider while
    // the database assignment is still locked, before committing any action.
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: RegisteredSession
    try {
      current = await Promise.race([
        verifyRegisteredSession(projectId, cookie, verifier),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Identity recheck timed out')), 5000) }),
      ])
    } finally { if (timer) clearTimeout(timer) }
    if (current.state !== 'verified' || current.uid !== session.uid || current.email !== session.email) {
      await client.query('ROLLBACK')
      return { state: current.state === 'unauthenticated' ? 'unauthenticated' : 'forbidden' }
    }
    await client.query('COMMIT')
    return { state: 'authorized', value }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
