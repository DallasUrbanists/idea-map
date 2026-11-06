import type pg from 'pg'
import { runtimeDatabasePool } from './runtime-database.js'
import { verifyRegisteredSession, type RegisteredSession, type RegisteredSessionVerifier } from './moderator-authorization.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function reference(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && Buffer.byteLength(value) <= max && !/[\x00-\x1f\x7f]/u.test(value)
}

type Outcome = 'forbidden' | 'processed' | 'not_found' | 'already_held' | 'already_released'
type Access = { state: 'unauthenticated' | Outcome }
export type LegalAuthorityAccess<T> = { state: 'unauthenticated' | 'forbidden' } | { state: 'authorized', value: T }

/** The verifier is the configured Firebase Admin SDK; never accept client-supplied actor IDs. */
export async function withLegalAuthority<T>(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  action: (client: pg.PoolClient, provider: string, subject: string) => Promise<T>): Promise<LegalAuthorityAccess<T>> {
  if (!databaseUrl) throw new Error('Invalid legal-hold configuration')
  const session = await verifyRegisteredSession(projectId, cookie, verifier)
  if (session.state !== 'verified') return session
  const client = await runtimeDatabasePool(databaseUrl).connect()
  let destroy = false
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const provider = `firebase:${projectId}`
    const role = await client.query<{ user_id: string | null }>('SELECT public.lock_active_legal_hold_authority($1,$2) AS user_id', [provider, session.uid])
    if (!role.rows[0]?.user_id) { await client.query('ROLLBACK'); return { state: 'forbidden' } }
    const outcome = await action(client, provider, session.uid)
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
    return { state: 'authorized', value: outcome }
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { destroy = true }
    throw error
  } finally { client.release(destroy) }
}

/** Server-only, disabled until scoped permissions, lifecycle, and deletion integration are reviewed. */
export async function placeLegalHold(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { ideaId: string, caseReference: string, reason: string }): Promise<Access> {
  if (!uuid.test(input.ideaId) || !reference(input.caseReference, 300) || !reference(input.reason, 1000)) throw new Error('Invalid legal hold')
  const access = await withLegalAuthority(databaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    const result = await client.query<{ outcome: Outcome }>('SELECT public.place_legal_hold_outcome($1,$2,$3,$4,$5) AS outcome', [provider, subject, input.ideaId, input.caseReference, input.reason])
    if (!result.rows[0]?.outcome) throw new Error('Missing legal-hold outcome')
    return result.rows[0].outcome
  })
  return { state: access.state === 'authorized' ? access.value : access.state }
}

/** Release only the named case; other active holds remain effective. */
export async function releaseLegalHold(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { holdId: string, reason: string, legalReviewReference: string | null }): Promise<Access> {
  if (!uuid.test(input.holdId) || !reference(input.reason, 1000) || (input.legalReviewReference !== null && !reference(input.legalReviewReference, 300))) throw new Error('Invalid legal hold release')
  const access = await withLegalAuthority(databaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    const result = await client.query<{ outcome: Outcome }>('SELECT public.release_legal_hold_outcome($1,$2,$3,$4,$5) AS outcome', [provider, subject, input.holdId, input.reason, input.legalReviewReference])
    if (!result.rows[0]?.outcome) throw new Error('Missing legal-hold outcome')
    return result.rows[0].outcome
  })
  return { state: access.state === 'authorized' ? access.value : access.state }
}

/** Check active holds only, inside the deletion transaction; this is not deletion authorization. */
export async function lockIdeaIfNotHeld(client: pg.PoolClient, ideaId: string): Promise<boolean> {
  if (!uuid.test(ideaId)) return false
  const result = await client.query<{ allowed: boolean }>('SELECT public.lock_idea_for_retention($1) AS allowed', [ideaId])
  return result.rows[0]?.allowed === true
}
