import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeRecoveryRecord, encodeRecoveryConfirmation, encodeRecoveryHoldConfirmation, encodeRecoveryHoldEvidence, encodeRecoveryIntent, recoveryConfirmationRecordId } from '../dist/recovery-journal-record.js'

const base = { operationId: '11111111-1111-4111-8111-111111111111', environment: 'dev',
  ideaId: '22222222-2222-4222-8222-222222222222', actorId: '33333333-3333-4333-8333-333333333333',
  authorizedAt: '2026-11-03T12:00:00.000Z' }
const placement = { kind: 'hold_placement', caseReference: 'synthetic case', reason: 'synthetic reason',
  authorizationReference: 'synthetic authority', scope: 'synthetic scoped material' }
const decode = value => JSON.parse(Buffer.from(value).toString('utf8'))

test('confirmation record IDs are stable UUIDv8 values distinct from intent UUIDv4 IDs', () => {
  assert.equal(recoveryConfirmationRecordId(base.operationId), '5d8900a6-1e2f-8723-b310-940ebe35dd66')
  assert.notEqual(recoveryConfirmationRecordId('11111111-1111-4111-8111-111111111112'), recoveryConfirmationRecordId(base.operationId))
  assert.throws(() => recoveryConfirmationRecordId('../bad'), /Invalid recovery confirmation/)
})

test('decision records preserve authorized removal and hold facts without extra fields', () => {
  for (const decision of [
    { kind: 'removal', classification: 'violation', reason: 'synthetic reason' }, placement,
    { ...placement, kind: 'hold_release', holdId: '44444444-4444-4444-8444-444444444444', legalReviewReference: null },
  ]) {
    assert.deepEqual(decode(encodeRecoveryIntent({ ...base, decision })),
      { version: 1, recordType: 'intent', ...base, decision })
  }
  assert.deepEqual(decode(encodeRecoveryConfirmation(base.operationId, 'dev', base.authorizedAt)),
    { version: 1, recordType: 'commit_confirmation', operationId: base.operationId, environment: 'dev', confirmedAt: base.authorizedAt })
  const intent = encodeRecoveryIntent({ ...base, decision: placement })
  const confirmation = encodeRecoveryConfirmation(base.operationId, 'dev', base.authorizedAt)
  assert.deepEqual(decodeRecoveryRecord(intent, 'dev'), decode(intent))
  assert.deepEqual(decodeRecoveryRecord(confirmation, 'dev'), decode(confirmation))
  const holdConfirmation = encodeRecoveryHoldConfirmation(base.operationId, 'dev', base.authorizedAt, '44444444-4444-4444-8444-444444444444')
  assert.deepEqual(decodeRecoveryRecord(holdConfirmation, 'dev'), decode(holdConfirmation))
  assert.equal(decode(holdConfirmation).version, 2)
})

test('decision records reject missing, unsafe, or incompatible facts', () => {
  const removal = { kind: 'removal', classification: 'other', reason: 'synthetic reason' }
  for (const input of [
    { ...base, environment: 'other', decision: removal },
    { ...base, operationId: '../bad', decision: removal },
    { ...base, authorizedAt: '2026-11-03', decision: removal },
    { ...base, actorId: 'not-a-user', decision: removal },
    { ...base, actorId: { toString: () => base.actorId }, decision: removal },
    { ...base, decision: { ...removal, reason: 'bad\nreason' } },
    { ...base, decision: { ...removal, reason: '\ud800' } },
    { ...base, decision: { ...placement, authorizationReference: '' } },
    { ...base, decision: { ...placement, caseReference: 'é'.repeat(151) } },
    { ...base, decision: { ...placement, unexpectedContent: 'must not be stored' } },
    { ...base, decision: { ...placement, kind: 'hold_release', holdId: 'invalid', legalReviewReference: null } },
    { ...base, unexpectedContent: 'must not be stored', decision: removal },
  ]) assert.throws(() => encodeRecoveryIntent(input), { message: 'Invalid recovery decision' })
  assert.throws(() => encodeRecoveryConfirmation(base.operationId, 'dev', 'bad'), { message: 'Invalid recovery confirmation' })
  assert.throws(() => encodeRecoveryHoldConfirmation(base.operationId, 'dev', base.authorizedAt, 'bad'), { message: 'Invalid recovery confirmation' })
})

test('recovery rejects wrong-environment, ambiguous, noncanonical, or future record formats', () => {
  const record = encodeRecoveryIntent({ ...base, decision: placement })
  const original = Buffer.from(record).toString('utf8')
  for (const [payload, environment] of [
    [record, 'prod'], [Buffer.from(original.replace('"version":1', '"version":2')), 'dev'],
    [Buffer.from(original.replace('"version":1', '"version":1,"version":1')), 'dev'],
    [Buffer.from(`${original} `), 'dev'], [Buffer.from(original.replace('"recordType":"intent"', '"recordType":"unknown"')), 'dev'],
    [Buffer.from([0xff]), 'dev'],
  ]) assert.throws(() => decodeRecoveryRecord(payload, environment), { message: 'Recovery record is invalid or incompatible' })
})

test('hold evidence preserves the authority reference and exact microsecond placement time', () => {
  const holdId = '44444444-4444-4444-8444-444444444444'
  const authority = '55555555-5555-4555-8555-555555555555'
  const placedAt = '2026-11-03T12:00:00.123456Z'
  const result = encodeRecoveryHoldEvidence(base.operationId, 'dev', '2026-11-03T12:00:00.123Z', holdId, authority, placedAt)
  assert.deepEqual(decodeRecoveryRecord(result, 'dev'), { version: 3, recordType: 'hold_commit_confirmation',
    operationId: base.operationId, environment: 'dev', confirmedAt: '2026-11-03T12:00:00.123Z',
    holdId, placementAuthorityId: authority, placedAt })
  assert.throws(() => encodeRecoveryHoldEvidence(base.operationId, 'dev', base.authorizedAt, holdId, authority, '2026-02-30T12:00:00.000000Z'))
  assert.throws(() => encodeRecoveryHoldEvidence(base.operationId, 'dev', base.authorizedAt, holdId, authority, '2026-11-03T12:00:01.000000Z'))
  assert.throws(() => encodeRecoveryHoldEvidence(base.operationId, 'dev', base.authorizedAt, holdId, 'invalid', '2026-11-03T12:00:00.000000Z'))
})
