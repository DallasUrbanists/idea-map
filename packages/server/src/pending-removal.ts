import { decodeRecoveryRecord, encodeRecoveryConfirmation, encodeRecoveryIntent, recoveryConfirmationRecordId } from './recovery-journal-record.js'
import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'
import { pendingRemovalDatabasePool } from './runtime-database.js'
import { compareCurrentRecoveryJournalRecord, writeRecoveryJournalRecord } from './recovery-journal-storage.js'
import type { Storage } from '@google-cloud/storage'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const journalReason = 'Authorized removal'
type PendingResult = 'stale' | { state: 'pending', recordId: string, payload: Uint8Array }
type PendingRemovalInput = {
  operationId: string, recordId: string, ideaId: string, approvedRevisionId: string,
  classification: 'violation' | 'other', reason: string,
}

/**
 * Persist an authorized pending removal and close the gate in one transaction.
 * This is unwired: it does not write the journal, remove content, prevent SQL
 * bypasses, drain active readers, or reopen access. A caller must retain both
 * IDs and retry the same operation after an uncertain result.
 */
export async function preparePendingRemoval(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, environment: 'dev' | 'prod', input: PendingRemovalInput): Promise<ModeratorAccess<PendingResult>> {
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

/**
 * Write the committed intent once. An uncertain outcome keeps the pending row
 * and gate closed; a separate authorized reader must reconcile a conflict.
 * This does not remove content, confirm a database mutation, or reopen access.
 */
export async function prepareAndJournalRemoval(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', bucket: string },
  storage: Storage, input: PendingRemovalInput): Promise<ModeratorAccess<'stale' | 'journaled' | 'journal_uncertain'>> {
  const result = await preparePendingRemoval(databaseUrl, projectId, cookie, verifier, target?.environment, input)
  if (result.state !== 'authorized') return result
  if (result.value === 'stale') return { state: 'authorized', value: 'stale' }
  try {
    await writeRecoveryJournalRecord(storage, target, result.value.recordId, result.value.payload)
    return { state: 'authorized', value: 'journaled' }
  } catch {
    return { state: 'authorized', value: 'journal_uncertain' }
  }
}

/**
 * Unwired coordinator: verify the exact saved intent through a separately
 * authorized journal reader, then apply the existing removal while the gate is
 * closed and all public leases have drained. It never reopens access, writes a
 * confirmation, proves coverage, or grants the required database privilege.
 */
export async function applyJournaledRemoval(coordinatorDatabaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', bucket: string },
  reader: Storage, input: { operationId: string, recordId: string, payload: Uint8Array }): Promise<ModeratorAccess<'stale' | 'journal_uncertain' | {
    state: 'applied', recordId: string, generation: string, appliedAt: string,
  }>> {
  if (typeof coordinatorDatabaseUrl !== 'string' || !coordinatorDatabaseUrl || !input ||
      typeof input.operationId !== 'string' || !uuid4.test(input.operationId) ||
      typeof input.recordId !== 'string' || !uuid4.test(input.recordId) || !(input.payload instanceof Uint8Array) ||
      input.payload.byteLength < 1 || input.payload.byteLength > 16_384) throw new Error('Invalid pending removal')
  const payload = Buffer.from(input.payload)
  let record
  try { record = decodeRecoveryRecord(payload, target?.environment) } catch { throw new Error('Invalid pending removal') }
  if (record.recordType !== 'intent' || record.operationId !== input.operationId || record.decision.kind !== 'removal') {
    throw new Error('Invalid pending removal')
  }
  try {
    return await withVerifiedModerator(coordinatorDatabaseUrl, projectId, cookie, verifier, async (client, actor, subject) => {
      if (record.actorId !== actor) throw new Error('Pending removal is ambiguous')
      let generation: string
      try {
        const match = await compareCurrentRecoveryJournalRecord(reader, target, input.recordId, payload)
        generation = match.generation
      } catch {
        return 'journal_uncertain' as const
      }
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '10s'")
      const result = await client.query<{ outcome: string, applied_at: Date | null, verified_generation: string | null }>(
        'SELECT * FROM public.apply_pending_removal($1,$2,$3,$4,$5,$6)',
        [`firebase:${projectId}`, subject, input.operationId, input.recordId, generation, payload.toString('utf8')])
      const row = result.rows[0]
      if (row?.outcome === 'stale' && row.applied_at === null && row.verified_generation === null) return 'stale' as const
      if (row?.outcome !== 'applied' || !(row.applied_at instanceof Date) || !Number.isFinite(row.applied_at.getTime()) ||
          row.verified_generation !== generation) throw new Error('Pending removal is ambiguous')
      return { state: 'applied' as const, recordId: input.recordId, generation, appliedAt: row.applied_at.toISOString() }
    }, pendingRemovalDatabasePool(coordinatorDatabaseUrl))
  } catch {
    throw new Error('Pending removal unavailable')
  }
}

type AppliedRemoval = { operationId: string, recordId: string, payload: Uint8Array, generation: string, appliedAt: string }
type PreparedConfirmation = { recordId: string, payload: Uint8Array, preparedAt: string }

/** Persist retry-stable confirmation facts only in a later committed transaction. */
export async function prepareRemovalConfirmation(coordinatorDatabaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, environment: 'dev' | 'prod', input: AppliedRemoval): Promise<ModeratorAccess<PreparedConfirmation>> {
  if (typeof coordinatorDatabaseUrl !== 'string' || !coordinatorDatabaseUrl || !input ||
      typeof input.operationId !== 'string' || !uuid4.test(input.operationId) ||
      typeof input.recordId !== 'string' || !uuid4.test(input.recordId) || !(input.payload instanceof Uint8Array) ||
      input.payload.byteLength < 1 || input.payload.byteLength > 16_384 || typeof input.generation !== 'string' ||
      !/^[1-9][0-9]{0,19}$/.test(input.generation) || typeof input.appliedAt !== 'string') throw new Error('Invalid pending removal')
  const appliedTime = Date.parse(input.appliedAt)
  if (!Number.isFinite(appliedTime) || new Date(appliedTime).toISOString() !== input.appliedAt) throw new Error('Invalid pending removal')
  const payload = Buffer.from(input.payload)
  let record
  try { record = decodeRecoveryRecord(payload, environment) } catch { throw new Error('Invalid pending removal') }
  if (record.recordType !== 'intent' || record.operationId !== input.operationId || record.decision.kind !== 'removal' ||
      Date.parse(record.authorizedAt) > appliedTime) throw new Error('Invalid pending removal')
  const confirmationId = recoveryConfirmationRecordId(input.operationId)
  try {
    const result = await withVerifiedModerator(coordinatorDatabaseUrl, projectId, cookie, verifier, async (client, actor, subject) => {
      if (record.actorId !== actor) throw new Error('Pending removal is ambiguous')
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '10s'")
      const selected = await client.query<{ confirmation_record_id: string, confirmation_prepared_at: Date }>(
        'SELECT * FROM public.prepare_pending_removal_confirmation($1,$2,$3,$4,$5,$6,$7,$8)',
        [`firebase:${projectId}`, subject, input.operationId, input.recordId, input.generation, payload.toString('utf8'), input.appliedAt, confirmationId])
      const row = selected.rows[0]
      if (row?.confirmation_record_id !== confirmationId || !(row.confirmation_prepared_at instanceof Date) ||
          !Number.isFinite(row.confirmation_prepared_at.getTime()) || row.confirmation_prepared_at.getTime() < appliedTime) {
        throw new Error('Pending removal is ambiguous')
      }
      return row.confirmation_prepared_at.toISOString()
    }, pendingRemovalDatabasePool(coordinatorDatabaseUrl))
    if (result.state !== 'authorized') return result
    return { state: 'authorized', value: { recordId: confirmationId,
      payload: encodeRecoveryConfirmation(input.operationId, environment, result.value), preparedAt: result.value } }
  } catch {
    throw new Error('Pending removal unavailable')
  }
}

/** Create a prepared confirmation once; an uncertain write never opens the gate. */
export async function writeRemovalConfirmation(coordinatorDatabaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', bucket: string },
  writer: Storage, input: AppliedRemoval): Promise<ModeratorAccess<'confirmation_uncertain' | { state: 'confirmation_written', recordId: string }>> {
  const prepared = await prepareRemovalConfirmation(coordinatorDatabaseUrl, projectId, cookie, verifier, target?.environment, input)
  if (prepared.state !== 'authorized') return prepared
  try {
    await writeRecoveryJournalRecord(writer, target, prepared.value.recordId, prepared.value.payload)
    return { state: 'authorized', value: { state: 'confirmation_written', recordId: prepared.value.recordId } }
  } catch {
    return { state: 'authorized', value: 'confirmation_uncertain' }
  }
}
