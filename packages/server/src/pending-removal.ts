import { decodeRecoveryRecord, encodeRecoveryConfirmation, encodeRecoveryIntent, recoveryConfirmationRecordId } from './recovery-journal-record.js'
import { withVerifiedModerator, type ModeratorAccess, type RegisteredSessionVerifier } from './moderator-authorization.js'
import { pendingRemovalDatabasePool } from './runtime-database.js'
import { encodeRecoverySequenceEntry } from './recovery-sequence.js'
import { appendAndVerifyRecoverySequenceVersion, readRecoverySequenceVersion, type RecoverySequenceTransport } from './recovery-sequence-storage.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const journalReason = 'Authorized removal'
type PendingResult = 'stale' | { state: 'pending', recordId: string, payload: Uint8Array }
type PendingRemovalInput = {
  operationId: string, recordId: string, ideaId: string, approvedRevisionId: string,
  classification: 'violation' | 'other', reason: string,
}

/** Pin a saved intent before any sequence append. This does not append or apply it. */
export async function pinPendingRemovalSequence(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', projectNumber: string, secretId: string, epochId: string },
  input: { operationId: string, recordId: string, payload: Uint8Array }): Promise<ModeratorAccess<'pinned'>> {
  if (typeof databaseUrl !== 'string' || !databaseUrl || !target || !['dev', 'prod'].includes(target.environment) ||
      typeof target.projectNumber !== 'string' || !/^[1-9][0-9]{5,19}$/.test(target.projectNumber) ||
      typeof target.secretId !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(target.secretId) ||
      typeof target.epochId !== 'string' || !uuid4.test(target.epochId) || !input ||
      typeof input.operationId !== 'string' || !uuid4.test(input.operationId) ||
      typeof input.recordId !== 'string' || !uuid4.test(input.recordId) || !(input.payload instanceof Uint8Array) ||
      input.payload.byteLength < 1 || input.payload.byteLength > 16_384) throw new Error('Invalid pending removal')
  const payload = Buffer.from(input.payload)
  const destination = { ...target }
  const operationId = input.operationId, recordId = input.recordId
  let record
  try { record = decodeRecoveryRecord(payload, destination.environment) } catch { throw new Error('Invalid pending removal') }
  if (record.recordType !== 'intent' || record.operationId !== operationId || record.decision.kind !== 'removal') {
    throw new Error('Invalid pending removal')
  }
  try {
    return await withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, actor, subject) => {
      if (record.actorId !== actor) throw new Error('Pending removal is ambiguous')
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '10s'")
      const result = await client.query<{ outcome: string }>('SELECT public.pin_pending_removal_sequence($1,$2,$3,$4,$5,$6,$7,$8) AS outcome',
        [`firebase:${projectId}`, subject, operationId, recordId, payload.toString('utf8'),
          destination.projectNumber, destination.secretId, destination.epochId])
      if (result.rows[0]?.outcome !== 'pinned') throw new Error('Pending removal is ambiguous')
      return 'pinned' as const
    }, pendingRemovalDatabasePool(databaseUrl))
  } catch {
    // A failed or uncertain commit cannot authorize an external append.
    throw new Error('Pending removal unavailable')
  }
}

/**
 * Pin a committed saved intent, then append and read its exact sequence version.
 * This unwired step neither applies the removal nor proves journal coverage.
 */
export async function journalPendingRemovalSequence(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', projectNumber: string, secretId: string, epochId: string },
  writer: RecoverySequenceTransport, reader: RecoverySequenceTransport,
  input: { operationId: string, recordId: string, payload: Uint8Array }): Promise<ModeratorAccess<
    'journal_uncertain' | { state: 'journaled', version: string, coverageVerified: false } |
    { state: 'applied', recordId: string, version: string, appliedAt: string }>> {
  if (!target || !input || !(input.payload instanceof Uint8Array)) throw new Error('Invalid pending removal')
  const destination = { ...target }
  const saved = { operationId: input.operationId, recordId: input.recordId, payload: Buffer.from(input.payload) }
  const pin = await pinPendingRemovalSequence(databaseUrl, projectId, cookie, verifier, destination, saved)
  if (pin.state !== 'authorized') return pin
  const status = await inspectSequenceRemoval(databaseUrl, projectId, cookie, verifier, destination, reader, saved)
  if (status.state !== 'authorized') return status
  if (status.value !== 'pending') return { state: 'authorized', value: status.value }
  try {
    const entry = encodeRecoverySequenceEntry({ kind: 'decision', environment: destination.environment,
      epochId: destination.epochId, recordId: saved.recordId, data: saved.payload.toString('base64') })
    const result = await appendAndVerifyRecoverySequenceVersion(writer, reader, destination, entry)
    return { state: 'authorized', value: { state: 'journaled', ...result } }
  } catch {
    return { state: 'authorized', value: 'journal_uncertain' }
  }
}

/** Apply only after an exact numbered readback; this cannot establish sequence coverage. */
export async function applySequenceJournaledRemoval(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', projectNumber: string, secretId: string, epochId: string },
  reader: RecoverySequenceTransport, input: { operationId: string, recordId: string, payload: Uint8Array, version: string }): Promise<ModeratorAccess<
    'stale' | 'journal_uncertain' | { state: 'applied', recordId: string, version: string, appliedAt: string }>> {
  if (typeof databaseUrl !== 'string' || !databaseUrl || !target || !input ||
      typeof input.operationId !== 'string' || !uuid4.test(input.operationId) ||
      typeof input.recordId !== 'string' || !uuid4.test(input.recordId) || !(input.payload instanceof Uint8Array) ||
      input.payload.byteLength < 1 || input.payload.byteLength > 16_384 || typeof input.version !== 'string' ||
      !/^[1-9][0-9]{0,4}$/.test(input.version) || Number(input.version) > 10_000) throw new Error('Invalid pending removal')
  const destination = { ...target }
  const saved = { operationId: input.operationId, recordId: input.recordId, payload: Buffer.from(input.payload), version: input.version }
  let record, expected: Uint8Array
  try {
    record = decodeRecoveryRecord(saved.payload, destination.environment)
    if (record.recordType !== 'intent' || record.operationId !== saved.operationId || record.decision.kind !== 'removal') throw new Error('Invalid')
    expected = encodeRecoverySequenceEntry({ kind: 'decision', environment: destination.environment,
      epochId: destination.epochId, recordId: saved.recordId, data: saved.payload.toString('base64') })
  } catch { throw new Error('Invalid pending removal') }
  try {
    return await withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, actor, subject) => {
      if (record.actorId !== actor) throw new Error('Pending removal is ambiguous')
      try {
        const observed = await readRecoverySequenceVersion(reader, destination, saved.version)
        if (!Buffer.from(observed).equals(expected)) throw new Error('Sequence differs')
      } catch { return 'journal_uncertain' as const }
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '10s'")
      const result = await client.query<{ outcome: string, applied_at: Date | null, verified_generation: string | null }>(
        'SELECT * FROM public.apply_pending_sequence_removal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [`firebase:${projectId}`, subject, saved.operationId, saved.recordId, saved.version, saved.payload.toString('utf8'),
          destination.environment, destination.projectNumber, destination.secretId, destination.epochId])
      const row = result.rows[0]
      if (row?.outcome === 'stale' && row.applied_at === null && row.verified_generation === null) return 'stale' as const
      if (row?.outcome !== 'applied' || !(row.applied_at instanceof Date) || !Number.isFinite(row.applied_at.getTime()) ||
          row.verified_generation !== saved.version) throw new Error('Pending removal is ambiguous')
      return { state: 'applied' as const, recordId: saved.recordId, version: saved.version, appliedAt: row.applied_at.toISOString() }
    }, pendingRemovalDatabasePool(databaseUrl))
  } catch { throw new Error('Pending removal unavailable') }
}

/** Reconcile a lost application response without appending a new version. */
export async function inspectSequenceRemoval(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', projectNumber: string, secretId: string, epochId: string },
  reader: RecoverySequenceTransport, input: { operationId: string, recordId: string, payload: Uint8Array }): Promise<ModeratorAccess<
    'pending' | 'journal_uncertain' | { state: 'applied', recordId: string, version: string, appliedAt: string }>> {
  if (typeof databaseUrl !== 'string' || !databaseUrl || !target || !input ||
      typeof input.operationId !== 'string' || !uuid4.test(input.operationId) ||
      typeof input.recordId !== 'string' || !uuid4.test(input.recordId) || !(input.payload instanceof Uint8Array) ||
      input.payload.byteLength < 1 || input.payload.byteLength > 16_384) throw new Error('Invalid pending removal')
  const destination = { ...target }
  const saved = { operationId: input.operationId, recordId: input.recordId, payload: Buffer.from(input.payload) }
  let record, expected: Uint8Array
  try {
    record = decodeRecoveryRecord(saved.payload, destination.environment)
    if (record.recordType !== 'intent' || record.operationId !== saved.operationId || record.decision.kind !== 'removal') throw new Error('Invalid')
    expected = encodeRecoverySequenceEntry({ kind: 'decision', environment: destination.environment,
      epochId: destination.epochId, recordId: saved.recordId, data: saved.payload.toString('base64') })
  } catch { throw new Error('Invalid pending removal') }
  try {
    return await withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, actor, subject) => {
      if (record.actorId !== actor) throw new Error('Pending removal is ambiguous')
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '10s'")
      const result = await client.query<{ outcome: string, applied_at: Date | null, verified_version: string | null }>(
        'SELECT * FROM public.pending_sequence_removal_status($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [`firebase:${projectId}`, subject, saved.operationId, saved.recordId, saved.payload.toString('utf8'),
          destination.environment, destination.projectNumber, destination.secretId, destination.epochId])
      const row = result.rows[0]
      if (row?.outcome === 'pending' && row.applied_at === null && row.verified_version === null) return 'pending' as const
      if (row?.outcome !== 'applied' || !(row.applied_at instanceof Date) || !Number.isFinite(row.applied_at.getTime()) ||
          typeof row.verified_version !== 'string' || !/^[1-9][0-9]{0,4}$/.test(row.verified_version) || Number(row.verified_version) > 10_000) {
        throw new Error('Pending removal is ambiguous')
      }
      try {
        const observed = await readRecoverySequenceVersion(reader, destination, row.verified_version)
        if (!Buffer.from(observed).equals(expected)) throw new Error('Sequence differs')
      } catch { return 'journal_uncertain' as const }
      return { state: 'applied' as const, recordId: saved.recordId, version: row.verified_version, appliedAt: row.applied_at.toISOString() }
    }, pendingRemovalDatabasePool(databaseUrl))
  } catch { throw new Error('Pending removal unavailable') }
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
  const saved = { operationId: input.operationId, recordId: input.recordId, generation: input.generation, appliedAt: input.appliedAt }
  let record
  try { record = decodeRecoveryRecord(payload, environment) } catch { throw new Error('Invalid pending removal') }
  if (record.recordType !== 'intent' || record.operationId !== saved.operationId || record.decision.kind !== 'removal' ||
      Date.parse(record.authorizedAt) > appliedTime) throw new Error('Invalid pending removal')
  const confirmationId = recoveryConfirmationRecordId(saved.operationId)
  try {
    const result = await withVerifiedModerator(coordinatorDatabaseUrl, projectId, cookie, verifier, async (client, actor, subject) => {
      if (record.actorId !== actor) throw new Error('Pending removal is ambiguous')
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '10s'")
      const selected = await client.query<{ confirmation_record_id: string, confirmation_prepared_at: Date }>(
        'SELECT * FROM public.prepare_pending_removal_confirmation($1,$2,$3,$4,$5,$6,$7,$8)',
        [`firebase:${projectId}`, subject, saved.operationId, saved.recordId, saved.generation, payload.toString('utf8'), saved.appliedAt, confirmationId])
      const row = selected.rows[0]
      if (row?.confirmation_record_id !== confirmationId || !(row.confirmation_prepared_at instanceof Date) ||
          !Number.isFinite(row.confirmation_prepared_at.getTime()) || row.confirmation_prepared_at.getTime() < appliedTime) {
        throw new Error('Pending removal is ambiguous')
      }
      return row.confirmation_prepared_at.toISOString()
    }, pendingRemovalDatabasePool(coordinatorDatabaseUrl))
    if (result.state !== 'authorized') return result
    return { state: 'authorized', value: { recordId: confirmationId,
      payload: encodeRecoveryConfirmation(saved.operationId, environment, result.value), preparedAt: result.value } }
  } catch {
    throw new Error('Pending removal unavailable')
  }
}

/** Append a committed, retry-stable confirmation to the pinned sequence. */
export async function journalSequenceRemovalConfirmation(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', projectNumber: string, secretId: string, epochId: string },
  writer: RecoverySequenceTransport, reader: RecoverySequenceTransport, input: AppliedRemoval): Promise<ModeratorAccess<
    'confirmation_uncertain' | { state: 'confirmation_journaled', recordId: string, version: string, coverageVerified: false }>> {
  if (!target || !input || !(input.payload instanceof Uint8Array)) throw new Error('Invalid pending removal')
  const destination = { ...target }
  const saved = { ...input, payload: Buffer.from(input.payload) }
  const pin = await pinPendingRemovalSequence(databaseUrl, projectId, cookie, verifier, destination, saved)
  if (pin.state !== 'authorized') return pin
  const prepared = await prepareRemovalConfirmation(databaseUrl, projectId, cookie, verifier, destination.environment, saved)
  if (prepared.state !== 'authorized') return prepared
  try {
    const entry = encodeRecoverySequenceEntry({ kind: 'decision', environment: destination.environment,
      epochId: destination.epochId, recordId: prepared.value.recordId, data: Buffer.from(prepared.value.payload).toString('base64') })
    const result = await appendAndVerifyRecoverySequenceVersion(writer, reader, destination, entry)
    return { state: 'authorized', value: { state: 'confirmation_journaled', recordId: prepared.value.recordId, ...result } }
  } catch { return { state: 'authorized', value: 'confirmation_uncertain' } }
}

/** Record exact sequence confirmation readback without opening the gate. */
export async function verifySequenceRemovalConfirmation(databaseUrl: string, projectId: string, cookie: string,
  verifier: RegisteredSessionVerifier, target: { environment: 'dev' | 'prod', projectNumber: string, secretId: string, epochId: string },
  reader: RecoverySequenceTransport, input: AppliedRemoval, version: string): Promise<ModeratorAccess<
    'confirmation_uncertain' | { state: 'confirmation_verified', recordId: string, version: string, verifiedAt: string }>> {
  if (!target || !input || !(input.payload instanceof Uint8Array) || typeof version !== 'string' ||
      !/^[1-9][0-9]{0,4}$/.test(version) || Number(version) > 10_000) throw new Error('Invalid pending removal')
  const destination = { ...target }, saved = { ...input, payload: Buffer.from(input.payload) }
  const prepared = await prepareRemovalConfirmation(databaseUrl, projectId, cookie, verifier, destination.environment, saved)
  if (prepared.state !== 'authorized') return prepared
  const entry = encodeRecoverySequenceEntry({ kind: 'decision', environment: destination.environment,
    epochId: destination.epochId, recordId: prepared.value.recordId, data: Buffer.from(prepared.value.payload).toString('base64') })
  try {
    return await withVerifiedModerator(databaseUrl, projectId, cookie, verifier, async (client, _actor, subject) => {
      try {
        const observed = await readRecoverySequenceVersion(reader, destination, version)
        if (!Buffer.from(observed).equals(entry)) throw new Error('Sequence differs')
      } catch { return 'confirmation_uncertain' as const }
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '10s'")
      const selected = await client.query<{ confirmation_verified_at: Date, confirmation_generation: string }>(
        'SELECT * FROM public.verify_pending_sequence_confirmation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [`firebase:${projectId}`, subject, saved.operationId, prepared.value.recordId, prepared.value.preparedAt,
          version, destination.environment, destination.projectNumber, destination.secretId, destination.epochId])
      const row = selected.rows[0]
      if (!(row?.confirmation_verified_at instanceof Date) || !Number.isFinite(row.confirmation_verified_at.getTime()) ||
          row.confirmation_verified_at.getTime() < Date.parse(prepared.value.preparedAt) || row.confirmation_generation !== version) {
        throw new Error('Pending removal is ambiguous')
      }
      return { state: 'confirmation_verified' as const, recordId: prepared.value.recordId, version,
        verifiedAt: row.confirmation_verified_at.toISOString() }
    }, pendingRemovalDatabasePool(databaseUrl))
  } catch { throw new Error('Pending removal unavailable') }
}
