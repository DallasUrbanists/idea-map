import type pg from 'pg'
import { runtimeDatabasePool } from './runtime-database.js'

interface VerifiedSession {
  uid: string
  email?: string
  email_verified?: boolean
  firebase?: { sign_in_provider?: string }
}

/** The verifier must be the configured Firebase Admin SDK, not client claims. */
export interface ModeratorSessionVerifier {
  verifySessionCookie(cookie: string, checkRevoked: boolean): Promise<VerifiedSession>
  getUser(uid: string): Promise<{ uid: string, email?: string, emailVerified: boolean, disabled: boolean }>
}

export type ModeratorAccess<T> =
  | { state: 'unauthenticated' | 'forbidden' }
  | { state: 'authorized', value: T }

/** Verify a current registered identity, then hold its database role lock through the action. */
export async function withVerifiedModerator<T>(databaseUrl: string, projectId: string, cookie: string,
  verifier: ModeratorSessionVerifier, action: (client: pg.PoolClient, userId: string) => Promise<T>): Promise<ModeratorAccess<T>> {
  if (!databaseUrl || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(projectId)) throw new Error('Invalid moderator configuration')
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
  const client = await runtimeDatabasePool(databaseUrl).connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ user_id: string | null }>(
      'SELECT public.lock_active_moderator($1, $2) AS user_id', [`firebase:${projectId}`, session.uid])
    const userId = result.rows[0]?.user_id
    if (!userId) { await client.query('ROLLBACK'); return { state: 'forbidden' } }
    const value = await action(client, userId)
    await client.query('COMMIT')
    return { state: 'authorized', value }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
