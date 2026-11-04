import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareUnverifiedRecoverySequence, decodeRecoverySequenceEntry, encodeRecoverySequenceEntry } from '../dist/recovery-sequence.js'
import { encodeRecoveryConfirmation, encodeRecoveryIntent, recoveryConfirmationRecordId } from '../dist/recovery-journal-record.js'

const epochId = '11111111-1111-4111-8111-111111111111'
const nonce = '22222222-2222-4222-8222-222222222222'
const base = { environment: 'dev', epochId }
const checkpoint = { ...base, kind: 'baseline', checkpointDigest: 'a'.repeat(64) }
const operationId = '33333333-3333-4333-8333-333333333333'
const input = { operationId, environment: 'dev', ideaId: '44444444-4444-4444-8444-444444444444',
  actorId: '55555555-5555-4555-8555-555555555555', authorizedAt: '2026-11-03T12:00:00.000Z',
  decision: { kind: 'removal', classification: 'other', reason: 'synthetic reason' } }
const data = Buffer.from(encodeRecoveryIntent(input)).toString('base64')
const record = { ...base, kind: 'decision', recordId: operationId, data }
const fence = { ...base, kind: 'fence', nonce }
const frames = entries => entries.map((entry, index) => ({ version: String(index + 1), payload: encodeRecoverySequenceEntry(entry) }))

test('a numbered sequence accounts for retry duplicates through the chosen fence without asserting coverage', () => {
  const entries = frames([checkpoint, checkpoint, record, record, fence, fence])
  assert.deepEqual(decodeRecoverySequenceEntry(entries[2].payload, 'dev', epochId), record)
  const result = compareUnverifiedRecoverySequence(entries, 'dev', epochId, '6', nonce)
  assert.equal(result.checkpointDigest, checkpoint.checkpointDigest)
  assert.deepEqual(result.records, [{ recordId: operationId, payload: Buffer.from(data, 'base64') }])
  assert.deepEqual(result.summary.removals, [input.ideaId])
  assert.equal(result.coverageVerified, false)
  assert.equal(compareUnverifiedRecoverySequence(frames([checkpoint, { ...fence, nonce: epochId }, record, fence]),
    'dev', epochId, '4', nonce).coverageVerified, false)
})

test('a gap, changed duplicate, or record after the selected fence fails closed', () => {
  const valid = frames([checkpoint, record, fence])
  assert.throws(() => compareUnverifiedRecoverySequence([valid[0], valid[2]], 'dev', epochId, '3', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence([{ ...valid[0], version: '2' }, valid[1], valid[2]], 'dev', epochId, '3', nonce), /could not be verified/)
  const changed = { ...record, data: Buffer.from(encodeRecoveryIntent({ ...input, decision: { ...input.decision, reason: 'different synthetic reason' } })).toString('base64') }
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, record, changed, fence]), 'dev', epochId, '4', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, record, { ...record, recordId: '66666666-6666-4666-8666-666666666666' }, fence]),
    'dev', epochId, '4', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, fence, record, fence]), 'dev', epochId, '4', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, record, { ...fence, nonce: epochId }]), 'dev', epochId, '3', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([record, fence]), 'dev', epochId, '2', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, record, checkpoint, fence]), 'dev', epochId, '4', nonce), /could not be verified/)
})

test('entries reject noncanonical data, wrong environments, and malformed references', () => {
  const payload = encodeRecoverySequenceEntry(record)
  assert.throws(() => decodeRecoverySequenceEntry(payload, 'prod', epochId), /invalid or incompatible/)
  assert.throws(() => decodeRecoverySequenceEntry(Buffer.from(`${payload.toString()} `), 'dev', epochId), /invalid or incompatible/)
  assert.throws(() => encodeRecoverySequenceEntry({ ...record, data: 'not base64' }), /Invalid/)
  assert.throws(() => encodeRecoverySequenceEntry({ ...record, extra: true }), /Invalid/)
  assert.throws(() => compareUnverifiedRecoverySequence([], 'dev', epochId, '10001', nonce), /could not be verified/)
  const confirmation = { ...base, kind: 'decision', recordId: recoveryConfirmationRecordId(operationId),
    data: Buffer.from(encodeRecoveryConfirmation(operationId, 'dev', '2026-11-03T12:01:00.000Z')).toString('base64') }
  assert.doesNotThrow(() => encodeRecoverySequenceEntry(confirmation))
  assert.throws(() => encodeRecoverySequenceEntry({ ...confirmation, recordId: operationId }), /Invalid/)
  assert.deepEqual(compareUnverifiedRecoverySequence(frames([checkpoint, record, confirmation, fence]),
    'dev', epochId, '4', nonce).summary.reviewOperations, [])
})
