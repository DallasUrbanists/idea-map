import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareUnverifiedRecoverySequence, decodeRecoverySequenceEntry, encodeRecoverySequenceEntry } from '../dist/recovery-sequence.js'

const epochId = '11111111-1111-4111-8111-111111111111'
const nonce = '22222222-2222-4222-8222-222222222222'
const base = { environment: 'dev', epochId }
const checkpoint = { ...base, kind: 'baseline', checkpointDigest: 'a'.repeat(64) }
const record = { ...base, kind: 'record', recordId: '33333333-3333-4333-8333-333333333333',
  generation: '90071992547409931234', sha256: 'b'.repeat(64) }
const fence = { ...base, kind: 'fence', nonce }
const frames = entries => entries.map((entry, index) => ({ version: String(index + 1), payload: encodeRecoverySequenceEntry(entry) }))

test('a numbered sequence accounts for retry duplicates through the chosen fence without asserting coverage', () => {
  const entries = frames([checkpoint, checkpoint, record, record, fence, fence])
  assert.deepEqual(decodeRecoverySequenceEntry(entries[2].payload, 'dev', epochId), record)
  assert.deepEqual(compareUnverifiedRecoverySequence(entries, 'dev', epochId, '6', nonce), {
    checkpointDigest: checkpoint.checkpointDigest,
    references: [{ recordId: record.recordId, generation: record.generation, sha256: record.sha256 }], coverageVerified: false,
  })
  assert.equal(compareUnverifiedRecoverySequence(frames([checkpoint, { ...fence, nonce: epochId }, record, fence]),
    'dev', epochId, '4', nonce).coverageVerified, false)
})

test('a gap, changed duplicate, or record after the selected fence fails closed', () => {
  const valid = frames([checkpoint, record, fence])
  assert.throws(() => compareUnverifiedRecoverySequence([valid[0], valid[2]], 'dev', epochId, '3', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence([{ ...valid[0], version: '2' }, valid[1], valid[2]], 'dev', epochId, '3', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, record, { ...record, generation: '2' }, fence]), 'dev', epochId, '4', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, fence, record, fence]), 'dev', epochId, '4', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, record, { ...fence, nonce: epochId }]), 'dev', epochId, '3', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([record, fence]), 'dev', epochId, '2', nonce), /could not be verified/)
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, record, checkpoint, fence]), 'dev', epochId, '4', nonce), /could not be verified/)
})

test('entries reject noncanonical data, wrong environments, and malformed references', () => {
  const payload = encodeRecoverySequenceEntry(record)
  assert.throws(() => decodeRecoverySequenceEntry(payload, 'prod', epochId), /invalid or incompatible/)
  assert.throws(() => decodeRecoverySequenceEntry(Buffer.from(`${payload.toString()} `), 'dev', epochId), /invalid or incompatible/)
  assert.throws(() => encodeRecoverySequenceEntry({ ...record, generation: '01' }), /Invalid/)
  assert.throws(() => encodeRecoverySequenceEntry({ ...record, extra: true }), /Invalid/)
  assert.throws(() => compareUnverifiedRecoverySequence([], 'dev', epochId, '10001', nonce), /could not be verified/)
})
