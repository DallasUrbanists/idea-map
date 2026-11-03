import type pg from 'pg'
import { runtimeDatabasePool } from './runtime-database.js'
import { verifyRegisteredSession, type RegisteredSession, type RegisteredSessionVerifier } from './moderator-authorization.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function reference(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && Buffer.byteLength(value) <= max && !/[\x00-\x1f\x7f]/u.test(value)
}

type Access = { state: 'unauthenticated' | 'forbidden' | 'processed' }

/** The verifier is the configured Firebase Admin SDK; never accept client-supplied actor IDs. */
async function withLegalAuthority(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  action: (client: pg.PoolClient, provider: string, subject: string) => Promise<void>): Promise<Access> {
  if (!databaseUrl) throw new Error('Invalid legal-hold configuration')
  const session = await verifyRegisteredSession(projectId, cookie, verifier)
  if (session.state !== 'verified') return session
  const client = await runtimeDatabasePool(databaseUrl).connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const provider = `firebase:${projectId}`
    const role = await client.query<{ user_id: string | null }>('SELECT public.lock_active_legal_hold_authority($1,$2) AS user_id', [provider, session.uid])
    if (!role.rows[0]?.user_id) { await client.query('ROLLBACK'); return { state: 'forbidden' } }
    await action(client, provider, session.uid)
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
    return { state: 'processed' }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

/** Server-only, disabled until scoped permissions, lifecycle, and deletion integration are reviewed. */
export async function placeLegalHold(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { ideaId: string, caseReference: string, reason: string }): Promise<Access> {
  if (!uuid.test(input.ideaId) || !reference(input.caseReference, 300) || !reference(input.reason, 1000)) throw new Error('Invalid legal hold')
  return withLegalAuthority(databaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    await client.query('SELECT public.place_legal_hold($1,$2,$3,$4,$5)', [provider, subject, input.ideaId, input.caseReference, input.reason])
  })
}

/** Release only the named case; other active holds remain effective. */
export async function releaseLegalHold(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { holdId: string, reason: string, legalReviewReference: string | null }): Promise<Access> {
  if (!uuid.test(input.holdId) || !reference(input.reason, 1000) || (input.legalReviewReference !== null && !reference(input.legalReviewReference, 300))) throw new Error('Invalid legal hold release')
  return withLegalAuthority(databaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    await client.query('SELECT public.release_legal_hold($1,$2,$3,$4,$5)', [provider, subject, input.holdId, input.reason, input.legalReviewReference])
  })
}

/** Record a case-specific date or an amendment; this does not delete records. */
export async function recordLegalHoldDisposition(databaseUrl: string, projectId: string, cookie: string, verifier: RegisteredSessionVerifier,
  input: { holdId: string, expectedSequence: number, deleteBy: string, basis: string, legalReviewReference: string | null }): Promise<Access | { state: 'processed', outcome: 'recorded' | 'stale' | 'not-released' }> {
  const validDate = /^\d{4}-\d{2}-\d{2}$/u.test(input.deleteBy) && input.deleteBy >= '1000-01-01' &&
    !Number.isNaN(Date.parse(`${input.deleteBy}T00:00:00Z`)) && new Date(`${input.deleteBy}T00:00:00Z`).toISOString().slice(0, 10) === input.deleteBy
  if (!uuid.test(input.holdId) || !Number.isInteger(input.expectedSequence) || input.expectedSequence < 0 || input.expectedSequence >= 2147483647 ||
      !validDate || !reference(input.basis, 1000) || (input.legalReviewReference !== null && !reference(input.legalReviewReference, 300))) throw new Error('Invalid legal hold disposition')
  let outcome: 'recorded' | 'stale' | 'not-released' = 'not-released'
  const access = await withLegalAuthority(databaseUrl, projectId, cookie, verifier, async (client, provider, subject) => {
    const result = await client.query<{ outcome: 'recorded' | 'stale' | 'not-released' }>(
      'SELECT public.record_legal_hold_disposition($1,$2,$3,$4,$5,$6,$7) AS outcome',
      [provider, subject, input.holdId, input.expectedSequence, input.deleteBy, input.basis, input.legalReviewReference])
    outcome = result.rows[0].outcome
  })
  return access.state === 'processed' ? { state: 'processed', outcome } : access
}

/** Check active holds only, inside the deletion transaction; this is not deletion authorization. */
export async function lockIdeaIfNotHeld(client: pg.PoolClient, ideaId: string): Promise<boolean> {
  if (!uuid.test(ideaId)) return false
  const result = await client.query<{ allowed: boolean }>('SELECT public.lock_idea_for_retention($1) AS allowed', [ideaId])
  return result.rows[0]?.allowed === true
}
