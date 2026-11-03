import { decodeRecoveryRecord, encodeRecoveryIntent } from './recovery-journal-record.js'
import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'
import { pendingRemovalDatabasePool } from './runtime-database.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const journalReason = 'Authorized removal'
type PendingResult = 'stale' | { state: 'pending', recordId: string, payload: Uint8Array }

/**
 * Persist an authorized pending removal and close the gate in one transaction.
 * This is unwired: it does not write the journal, remove content, prevent SQL
 * bypasses, or reopen access. A caller must retain both IDs and retry the same
 * operation after an uncertain result.
 */
export async function preparePendingRemoval(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, environment: 'dev' | 'prod', input: {
    operationId: string, recordId: string, ideaId: string, approvedRevisionId: string,
    classification: 'violation' | 'other', reason: string,
  }): Promise<ModeratorAccess<PendingResult>> {
  if (!databaseUrl || !['dev', 'prod'].includes(environment) || !input || typeof input !== 'object' ||
      typeof input.operationId !== 'string' || !uuid4.test(input.operationId) ||
      typeof input.recordId !== 'string' || !uuid4.test(input.recordId) ||
      typeof input.ideaId !== 'string' || !uuid.test(input.ideaId) ||
      typeof input.approvedRevisionId !== 'string' || !uuid.test(input.approvedRevisionId) ||
      !['violation', 'other'].includes(input.classification) || typeof input.reason !== 'string' ||
      !input.reason.trim() || Buffer.byteLength(input.reason) > 1000 ||
      Buffer.from(input.reason, 'utf8').toString('utf8') !== input.reason || /[\x00-\x1f\x7f]/u.test(input.reason)) {
    throw new Error('Invalid pending removal')
  }
  try {
    return await withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, actor, subject) => {
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '10s'")
      const time = await client.query<{ now: Date }>('SELECT pg_catalog.clock_timestamp() AS now')
      const authorizedAt = time.rows[0]?.now?.toISOString()
      const intent = encodeRecoveryIntent({ operationId: input.operationId, environment, ideaId: input.ideaId,
        actorId: actor, authorizedAt, decision: { kind: 'removal', classification: input.classification, reason: journalReason } })
      const result = await client.query<{ outcome: string, persisted_record_id: string | null, persisted_intent: string | null }>(
        'SELECT * FROM public.prepare_pending_removal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [`firebase:${projectId}`, subject, input.ideaId, input.approvedRevisionId, input.operationId, input.recordId,
          environment, input.classification, input.reason, Buffer.from(intent).toString('utf8')])
      const row = result.rows[0]
      if (row?.outcome === 'stale' && row.persisted_record_id === null && row.persisted_intent === null) return 'stale'
      if (row?.outcome !== 'pending' || row.persisted_record_id !== input.recordId || typeof row.persisted_intent !== 'string') {
        throw new Error('Pending removal is ambiguous')
      }
      const payload = Buffer.from(row.persisted_intent, 'utf8')
      const record = decodeRecoveryRecord(payload, environment)
      if (record.recordType !== 'intent' || record.operationId !== input.operationId || record.ideaId !== input.ideaId ||
          record.actorId !== actor || record.decision.kind !== 'removal' || record.decision.classification !== input.classification ||
          record.decision.reason !== journalReason) throw new Error('Pending removal is ambiguous')
      return { state: 'pending' as const, recordId: row.persisted_record_id, payload }
    }, pendingRemovalDatabasePool(databaseUrl))
  } catch {
    throw new Error('Pending removal unavailable')
  }
}
