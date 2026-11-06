import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareUnverifiedRecoverySequence, decodeRecoverySequenceEntry, encodeRecoverySequenceEntry } from '../dist/recovery-sequence.js'
import { compareUnverifiedSequenceChain, compareUnverifiedSequenceRollover, unverifiedRolloverCheckpoint } from '../dist/recovery-sequence-rollover.js'
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
  assert.throws(() => compareUnverifiedRecoverySequence(frames([checkpoint, confirmation, record, fence]),
    'dev', epochId, '4', nonce), /could not be verified/)
  assert.deepEqual(compareUnverifiedRecoverySequence(frames([checkpoint, record, confirmation, record, fence]),
    'dev', epochId, '5', nonce).summary.reviewOperations, [])
  const unmatched = compareUnverifiedRecoverySequence(frames([checkpoint, confirmation, fence]), 'dev', epochId, '3', nonce)
  assert.deepEqual(unmatched.summary.reviewOperations, [operationId])
  assert.equal(unmatched.summary.unmatchedConfirmations, 1)
})

test('a linked rollover combines exact epoch records without asserting writer coverage', () => {
  const previous = { ...base, projectNumber: '123456789', secretId: 'synthetic-old', fenceVersion: '3', fenceNonce: nonce }
  const oldFrames = frames([checkpoint, record, fence])
  const link = unverifiedRolloverCheckpoint(previous, oldFrames)
  assert.equal(link.coverageVerified, false)
  const nextEpoch = '77777777-7777-4777-8777-777777777777'
  const nextNonce = '88888888-8888-4888-8888-888888888888'
  const next = { ...previous, epochId: nextEpoch, secretId: 'synthetic-next', fenceNonce: nextNonce, fenceVersion: '4' }
  const nextBase = { environment: 'dev', epochId: nextEpoch }
  const confirmation = { ...nextBase, kind: 'decision', recordId: recoveryConfirmationRecordId(operationId),
    data: Buffer.from(encodeRecoveryConfirmation(operationId, 'dev', '2026-11-03T12:01:00.000Z')).toString('base64') }
  const nextFrames = frames([{ ...nextBase, kind: 'baseline', checkpointDigest: link.checkpointDigest },
    { ...record, ...nextBase }, confirmation, { ...nextBase, kind: 'fence', nonce: nextNonce }])
  const result = compareUnverifiedSequenceRollover(previous, oldFrames, next, nextFrames)
  assert.equal(result.coverageVerified, false)
  assert.equal(result.earlierEpochsIncluded, false)
  assert.equal(result.records.length, 2)
  assert.deepEqual(result.summary.removals, [input.ideaId])
  assert.deepEqual(result.summary.reviewOperations, [])
  assert.throws(() => compareUnverifiedSequenceRollover({ ...previous, secretId: 'wrong-secret' }, oldFrames, next, nextFrames), /could not be verified/)
  assert.throws(() => compareUnverifiedSequenceRollover(previous, oldFrames, { ...next, secretId: previous.secretId }, nextFrames), /could not be verified/)
  assert.throws(() => compareUnverifiedSequenceRollover(previous, oldFrames.slice(1), next, nextFrames), /could not be verified/)
  const changed = { ...record, ...nextBase, data: Buffer.from(encodeRecoveryIntent({ ...input,
    decision: { ...input.decision, reason: 'changed synthetic reason' } })).toString('base64') }
  const changedOld = frames([checkpoint, { ...changed, ...base }, fence])
  assert.throws(() => compareUnverifiedSequenceRollover(previous, changedOld, next, nextFrames), /could not be verified/)
  const conflicted = frames([{ ...nextBase, kind: 'baseline', checkpointDigest: link.checkpointDigest }, changed,
    confirmation, { ...nextBase, kind: 'fence', nonce: nextNonce }])
  assert.throws(() => compareUnverifiedSequenceRollover(previous, oldFrames, next, conflicted), /could not be verified/)
})

test('a rollover rejects an earlier confirmation followed by its first intent', () => {
  const previous = { ...base, projectNumber: '123456789', secretId: 'synthetic-old', fenceVersion: '3', fenceNonce: nonce }
  const confirmation = { ...base, kind: 'decision', recordId: recoveryConfirmationRecordId(operationId),
    data: Buffer.from(encodeRecoveryConfirmation(operationId, 'dev', '2026-11-03T12:01:00.000Z')).toString('base64') }
  const oldFrames = frames([checkpoint, confirmation, fence])
  const link = unverifiedRolloverCheckpoint(previous, oldFrames)
  const nextBase = { environment: 'dev', epochId: '77777777-7777-4777-8777-777777777777' }
  const next = { ...previous, epochId: nextBase.epochId, secretId: 'synthetic-next', fenceVersion: '3',
    fenceNonce: '88888888-8888-4888-8888-888888888888' }
  const nextFrames = frames([{ ...nextBase, kind: 'baseline', checkpointDigest: link.checkpointDigest },
    { ...record, ...nextBase }, { ...nextBase, kind: 'fence', nonce: next.fenceNonce }])
  assert.throws(() => compareUnverifiedSequenceRollover(previous, oldFrames, next, nextFrames), /could not be verified/)
})

test('a linked three-epoch chain retains selected earlier decisions and rejects reused secrets', () => {
  const first = { ...base, projectNumber: '123456789', secretId: 'synthetic-first', fenceVersion: '3', fenceNonce: nonce }
  const firstFrames = frames([checkpoint, record, fence])
  const secondBase = { environment: 'dev', epochId: '77777777-7777-4777-8777-777777777777' }
  const second = { ...first, epochId: secondBase.epochId, secretId: 'synthetic-second', fenceVersion: '4',
    fenceNonce: '88888888-8888-4888-8888-888888888888' }
  const firstConfirmation = { ...secondBase, kind: 'decision', recordId: recoveryConfirmationRecordId(operationId),
    data: Buffer.from(encodeRecoveryConfirmation(operationId, 'dev', '2026-11-03T12:01:00.000Z')).toString('base64') }
  const secondOperation = '99999999-9999-4999-8999-999999999999'
  const secondIdea = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const secondIntent = { ...secondBase, kind: 'decision', recordId: secondOperation,
    data: Buffer.from(encodeRecoveryIntent({ ...input, operationId: secondOperation, ideaId: secondIdea,
      authorizedAt: '2026-11-03T12:02:00.000Z' })).toString('base64') }
  const secondFrames = frames([{ ...secondBase, kind: 'baseline',
    checkpointDigest: unverifiedRolloverCheckpoint(first, firstFrames).checkpointDigest }, firstConfirmation, secondIntent,
  { ...secondBase, kind: 'fence', nonce: second.fenceNonce }])
  const thirdBase = { environment: 'dev', epochId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
  const third = { ...first, epochId: thirdBase.epochId, secretId: 'synthetic-third', fenceVersion: '3',
    fenceNonce: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }
  const secondConfirmation = { ...thirdBase, kind: 'decision', recordId: recoveryConfirmationRecordId(secondOperation),
    data: Buffer.from(encodeRecoveryConfirmation(secondOperation, 'dev', '2026-11-03T12:03:00.000Z')).toString('base64') }
  const thirdFrames = frames([{ ...thirdBase, kind: 'baseline',
    checkpointDigest: unverifiedRolloverCheckpoint(second, secondFrames).checkpointDigest }, secondConfirmation,
  { ...thirdBase, kind: 'fence', nonce: third.fenceNonce }])
  const chain = [{ descriptor: first, frames: firstFrames }, { descriptor: second, frames: secondFrames },
    { descriptor: third, frames: thirdFrames }]
  const result = compareUnverifiedSequenceChain(chain)
  assert.equal(result.epochCount, 3)
  assert.equal(result.earlierEpochsIncluded, false)
  assert.equal(result.coverageVerified, false)
  assert.equal(result.records.length, 4)
  assert.deepEqual(result.summary.removals, [input.ideaId, secondIdea])
  assert.deepEqual(result.summary.reviewOperations, [])
  assert.throws(() => compareUnverifiedSequenceChain([chain[0], chain[2]]), /could not be verified/)
  assert.throws(() => compareUnverifiedSequenceChain([chain[0], chain[1],
    { ...chain[2], descriptor: { ...third, secretId: first.secretId } }]), /could not be verified/)
  assert.throws(() => compareUnverifiedSequenceChain(Array(9).fill(chain[0])), /could not be verified/)
})
