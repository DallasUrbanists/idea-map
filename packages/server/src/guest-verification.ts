import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type pg from 'pg'
import { normalizeOwnershipEmail } from './verified-ownership.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tokenUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hex = /^[0-9a-f]{64}$/
function validKey(key: Buffer): boolean { return Buffer.isBuffer(key) && key.length >= 32 && key.length <= 128 }
function mac(key: Buffer, purpose: string, value: string): Buffer { return createHmac('sha256', key).update(`${purpose}\0${value}`, 'utf8').digest() }
function digest(secret: Buffer): string { return createHash('sha256').update(secret).digest('hex') }
function decode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length === 32 && bytes.toString('base64url') === value ? bytes : null
}
function parse(token: string, key: Buffer): { id: string, digest: string } | null {
  if (typeof token !== 'string' || token.length > 160) return null
  const parts = token.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1' || !tokenUuid.test(parts[1])) return null
  const secret = decode(parts[2])
  const supplied = decode(parts[3])
  if (!secret || !supplied || !timingSafeEqual(supplied, mac(key, 'guest-verify/v1', `${parts[1]}.${parts[2]}`))) return null
  return { id: parts[1], digest: digest(secret) }
}

type IssueResult = { state: 'unavailable' } | { state: 'issued', recipient: string, token: string, expiresAt: Date }
/**
 * Server-only primitive. The caller must enforce a real guest/draft authorization,
 * registered-email gate, rate limit and private delivery before using it. Never
 * return or log the recipient, token, or link in a public response.
 */
export async function issueGuestVerification(pool: pg.Pool, ideaId: string, key: Buffer, ttlSeconds: number,
  authorize: (client: pg.PoolClient, ideaId: string) => Promise<boolean>): Promise<IssueResult> {
  if (!uuid.test(ideaId) || !validKey(key) || !Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400 || typeof authorize !== 'function') throw new Error('Invalid guest verification configuration')
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const target = await client.query<{ contact_id: string, normalized_email: string }>('SELECT * FROM public.lock_guest_verification_target($1)', [ideaId])
    const address = target.rows[0]?.normalized_email
    if (!address || normalizeOwnershipEmail(address) !== address || !await authorize(client, ideaId)) {
      await client.query('ROLLBACK')
      return { state: 'unavailable' }
    }
    const id = randomUUID()
    const secret = randomBytes(32)
    const encoded = secret.toString('base64url')
    const signature = mac(key, 'guest-verify/v1', `${id}.${encoded}`).toString('base64url')
    const saved = await client.query<{ expires_at: Date | null }>('SELECT public.create_guest_verification($1,$2,$3,$4,$5,$6) AS expires_at',
      [ideaId, target.rows[0].contact_id, id, digest(secret), mac(key, 'guest-email/v1', address).toString('hex'), ttlSeconds])
    const expiresAt = saved.rows[0]?.expires_at
    if (!expiresAt) { await client.query('ROLLBACK'); return { state: 'unavailable' } }
    await client.query('COMMIT')
    return { state: 'issued', recipient: address, token: `v1.${id}.${encoded}.${signature}`, expiresAt }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

/** Consume one valid email proof without creating an owner, session or approval. */
export async function consumeGuestVerification(pool: pg.Pool, token: string, key: Buffer): Promise<boolean> {
  if (!validKey(key)) throw new Error('Invalid guest verification configuration')
  const parsed = parse(token, key)
  if (!parsed) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '10s'")
    const locked = await client.query<{ normalized_email: string, email_mac: string }>('SELECT * FROM public.lock_guest_verification($1,$2)', [parsed.id, parsed.digest])
    const row = locked.rows[0]
    if (!row || normalizeOwnershipEmail(row.normalized_email) !== row.normalized_email || !hex.test(row.email_mac) ||
        !timingSafeEqual(Buffer.from(row.email_mac, 'hex'), mac(key, 'guest-email/v1', row.normalized_email))) {
      await client.query('ROLLBACK')
      return false
    }
    const result = await client.query<{ consumed: boolean }>('SELECT public.consume_guest_verification($1,$2,$3) AS consumed', [parsed.id, parsed.digest, row.email_mac])
    if (!result.rows[0]?.consumed) { await client.query('ROLLBACK'); return false }
    await client.query('COMMIT')
    return true
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
