import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CRC32C } from '@google-cloud/storage'
import { encodeRecoveryIntent } from '../dist/recovery-journal-record.js'
import { encodeRecoverySequenceEntry } from '../dist/recovery-sequence.js'
import { appendAndVerifyRecoverySequenceVersion, appendRecoverySequenceVersion, inspectRecoverySequenceVersionOutsideScanLimit, readRecoverySequenceVersion, readUnverifiedRecoverySequence, readUnverifiedRecoverySequenceFrames } from '../dist/recovery-sequence-storage.js'
import { unverifiedRolloverCheckpoint } from '../dist/recovery-sequence-rollover.js'
import { readUnverifiedSequenceRollover } from '../dist/recovery-sequence-rollover-storage.js'
import { suppressKnownRemovalsFromRollover, suppressKnownRemovalsFromSequence } from '../dist/recovery-suppression.js'

const target = { environment: 'dev', epochId: '11111111-1111-4111-8111-111111111111',
  projectNumber: '123456789', secretId: 'synthetic-recovery-sequence' }
const nonce = '22222222-2222-4222-8222-222222222222'
const operationId = '33333333-3333-4333-8333-333333333333'
const base = { environment: target.environment, epochId: target.epochId }
const baseline = encodeRecoverySequenceEntry({ ...base, kind: 'baseline', checkpointDigest: 'a'.repeat(64) })
const intent = encodeRecoveryIntent({ operationId, environment: 'dev', ideaId: '44444444-4444-4444-8444-444444444444',
  actorId: '55555555-5555-4555-8555-555555555555', authorizedAt: '2026-11-03T12:00:00.000Z',
  decision: { kind: 'removal', classification: 'other', reason: 'synthetic private reason' } })
const decision = encodeRecoverySequenceEntry({ ...base, kind: 'decision', recordId: operationId, data: Buffer.from(intent).toString('base64') })
const fence = encodeRecoverySequenceEntry({ ...base, kind: 'fence', nonce })

function crc(bytes) {
  const value = new CRC32C(); value.update(bytes)
  return String(Buffer.from(value.toString(), 'base64').readUInt32BE(0))
}
function fake(source = target) {
  const versions = [], calls = []
  let lost = false, corrupt = false
  const parent = `projects/${source.projectNumber}/secrets/${source.secretId}`
  return { versions, calls, loseNext() { lost = true }, corruptNext() { corrupt = true }, transport: {
    async request(method, path, body, signal) {
      calls.push({ method, path })
      assert.equal(signal.aborted, false)
      if (method === 'POST') {
        assert.equal(path, `${parent}:addVersion`)
        const bytes = Buffer.from(body.payload.data, 'base64')
        assert.equal(body.payload.dataCrc32c, crc(bytes))
        versions.push(bytes)
        if (lost) { lost = false; throw new Error('synthetic private provider failure') }
        return { status: 200, data: { name: `${parent}/versions/${versions.length}`, state: 'ENABLED', clientSpecifiedPayloadChecksum: true } }
      }
      const match = new RegExp(`^${parent}/versions/([1-9][0-9]*):access$`).exec(path)
      assert.ok(match)
      const bytes = versions[Number(match[1]) - 1]
      if (!bytes) return { status: 404, data: { error: 'synthetic private error' } }
      const checksum = corrupt ? '0' : crc(bytes)
      corrupt = false
      return { status: 200, data: { name: `${parent}/versions/${match[1]}`, payload: { data: bytes.toString('base64'), dataCrc32c: checksum } } }
    },
  } }
}

test('numbered versions preserve exact decisions through ambiguous append retries', async () => {
  const f = fake()
  assert.deepEqual(await appendRecoverySequenceVersion(f.transport, target, baseline), { version: '1' })
  assert.deepEqual(await appendRecoverySequenceVersion(f.transport, target, decision), { version: '2' })
  f.loseNext()
  await assert.rejects(appendRecoverySequenceVersion(f.transport, target, fence), error =>
    error.message === 'Recovery sequence append outcome is uncertain' && !error.message.includes('private'))
  assert.deepEqual(await appendRecoverySequenceVersion(f.transport, target, fence), { version: '4' })
  assert.deepEqual(Buffer.from(await readRecoverySequenceVersion(f.transport, target, '2')), Buffer.from(decision))
  const sequence = await readUnverifiedRecoverySequence(f.transport, target, '4', nonce)
  assert.equal(sequence.records.length, 1)
  assert.deepEqual(sequence.records[0].payload, Buffer.from(intent))
  assert.equal(sequence.coverageVerified, false)
  assert.deepEqual(sequence.summary.removals, ['44444444-4444-4444-8444-444444444444'])
  assert.ok(f.calls.filter(call => call.method === 'GET').every(call => !call.path.includes('latest')))
})

test('rollover reads both exact sequences and retains unresolved removals without claiming coverage', async () => {
  const old = fake()
  for (const bytes of [baseline, decision, fence]) await appendRecoverySequenceVersion(old.transport, target, bytes)
  const previous = { ...target, fenceVersion: '3', fenceNonce: nonce }
  const previousRead = await readUnverifiedRecoverySequenceFrames(old.transport, target, '3', nonce)
  assert.equal(previousRead.coverageVerified, false)
  assert.equal(previousRead.frames.length, 3)
  const checkpoint = unverifiedRolloverCheckpoint(previous, previousRead.frames)
  const next = { ...target, epochId: '77777777-7777-4777-8777-777777777777', secretId: 'synthetic-next',
    fenceVersion: '3', fenceNonce: '88888888-8888-4888-8888-888888888888' }
  const nextSource = { ...next }
  const successor = fake(nextSource)
  const nextBase = { environment: 'dev', epochId: next.epochId }
  const nextOperation = '99999999-9999-4999-8999-999999999999'
  const nextIdea = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const nextIntent = encodeRecoveryIntent({ operationId: nextOperation, environment: 'dev', ideaId: nextIdea,
    actorId: '55555555-5555-4555-8555-555555555555', authorizedAt: '2026-11-03T12:02:00.000Z',
    decision: { kind: 'removal', classification: 'other', reason: 'synthetic private reason' } })
  const nextEntries = [encodeRecoverySequenceEntry({ ...nextBase, kind: 'baseline', checkpointDigest: checkpoint.checkpointDigest }),
    encodeRecoverySequenceEntry({ ...nextBase, kind: 'decision', recordId: nextOperation, data: Buffer.from(nextIntent).toString('base64') }),
    encodeRecoverySequenceEntry({ ...nextBase, kind: 'fence', nonce: next.fenceNonce })]
  for (const bytes of nextEntries) await appendRecoverySequenceVersion(successor.transport, nextSource, bytes)
  const mutablePrevious = { ...previous }, mutableNext = { ...next }
  const changingReader = { async request(...args) {
    mutablePrevious.secretId = 'changed-old'; mutableNext.secretId = 'changed-next'; mutableNext.environment = 'prod'
    return old.transport.request(...args)
  } }
  const result = await readUnverifiedSequenceRollover(changingReader, mutablePrevious, successor.transport, mutableNext)
  assert.equal(result.coverageVerified, false)
  assert.equal(result.earlierEpochsIncluded, false)
  assert.deepEqual(result.summary.removals, ['44444444-4444-4444-8444-444444444444', nextIdea])
  assert.equal(result.records.length, 2)
  assert.ok([...old.calls, ...successor.calls].filter(call => call.method === 'GET').every(call => !call.path.includes('latest')))
  const calls = []
  const client = { async query(statement, parameters) {
    calls.push({ statement, parameters })
    return { rows: statement.startsWith('SELECT * FROM public.suppress_restored_removals') ? [{ matched: 2, absent: 0 }] : [] }
  }, release() {} }
  const mutableForSuppression = { ...previous }
  const changingForSuppression = { async request(...args) {
    mutableForSuppression.environment = 'prod'; mutableForSuppression.secretId = 'changed-old'
    return old.transport.request(...args)
  } }
  const suppressed = await suppressKnownRemovalsFromRollover(changingForSuppression, mutableForSuppression,
    successor.transport, next, { async connect() { return client } })
  assert.deepEqual(suppressed, { matched: 2, absent: 0, reviewOperations: 2, coverageVerified: false, earlierEpochsIncluded: false })
  assert.deepEqual(calls.find(call => call.parameters)?.parameters, [['44444444-4444-4444-8444-444444444444', nextIdea]])
  assert.doesNotMatch(JSON.stringify(suppressed), /synthetic|44444444|aaaaaaaa/)
  successor.versions[1] = undefined
  await assert.rejects(readUnverifiedSequenceRollover(old.transport, previous, successor.transport, next), error =>
    error.message === 'Rollover sequence could not be verified' && !error.message.includes('private'))
  let connected = false
  await assert.rejects(suppressKnownRemovalsFromRollover(old.transport, previous, successor.transport, next,
    { async connect() { connected = true; throw new Error('unexpected database access') } }), /could not be verified/)
  assert.equal(connected, false)
})

test('rollover validates both targets before reading and shares one bounded deadline', async () => {
  const old = fake(), successor = fake()
  const previous = { ...target, fenceVersion: '3', fenceNonce: nonce }
  const next = { ...previous, epochId: '77777777-7777-4777-8777-777777777777' }
  await assert.rejects(readUnverifiedSequenceRollover(old.transport, previous, successor.transport, next), /Invalid rollover request/)
  assert.equal(old.calls.length, 0)
  assert.equal(successor.calls.length, 0)
  let signal
  const stalled = { async request(_method, _path, _body, requestSignal) { signal = requestSignal; return new Promise(() => {}) } }
  await assert.rejects(readUnverifiedSequenceRollover(stalled, previous, successor.transport, { ...next, secretId: 'synthetic-next' }, 20), /could not be verified/)
  assert.equal(signal.aborted, true)
  assert.equal(successor.calls.length, 0)
})

test('missing, corrupt, disabled, or incorrectly named versions do not establish a sequence', async () => {
  const f = fake()
  for (const bytes of [baseline, decision, fence]) await appendRecoverySequenceVersion(f.transport, target, bytes)
  f.corruptNext()
  await assert.rejects(readRecoverySequenceVersion(f.transport, target, '2'), /could not be verified/)
  f.versions[1] = undefined
  await assert.rejects(readUnverifiedRecoverySequence(f.transport, target, '3', nonce), /could not be verified/)
  await assert.rejects(readRecoverySequenceVersion(f.transport, target, 'latest'), /Invalid/)
  const denied = { async request() { return { status: 403, data: { error: 'synthetic private details' } } } }
  await assert.rejects(readRecoverySequenceVersion(denied, target, '1'), error =>
    error.message === 'Recovery sequence version could not be verified' && !error.message.includes('private'))
  const wrongName = { async request() { return { status: 200, data: { name: 'projects/other/secrets/x/versions/1',
    payload: { data: Buffer.from(baseline).toString('base64'), dataCrc32c: crc(baseline) } } } } }
  await assert.rejects(readRecoverySequenceVersion(wrongName, target, '1'), /could not be verified/)
  const unconfirmedChecksum = { async request() { return { status: 200, data: {
    name: `projects/${target.projectNumber}/secrets/${target.secretId}/versions/1`, state: 'ENABLED', clientSpecifiedPayloadChecksum: false,
  } } } }
  await assert.rejects(appendRecoverySequenceVersion(unconfirmedChecksum, target, baseline), /outcome is uncertain/)
})

test('timeouts abort the request and leave append outcomes uncertain', async () => {
  let signal
  const stalled = { async request(_method, _path, _body, requestSignal) { signal = requestSignal; return new Promise(() => {}) } }
  await assert.rejects(appendRecoverySequenceVersion(stalled, target, baseline, 20), /outcome is uncertain/)
  assert.equal(signal.aborted, true)
  await assert.rejects(readRecoverySequenceVersion(stalled, target, '1', 20), /could not be verified/)
  assert.equal(signal.aborted, true)
})

test('an append beyond the scan limit remains uncertain and requires explicit inspection', async () => {
  const f = fake()
  f.versions.length = 10_000
  await assert.rejects(appendRecoverySequenceVersion(f.transport, target, decision), /outcome is uncertain/)
  assert.equal(f.versions.length, 10_001)
  assert.deepEqual(f.versions[10_000], Buffer.from(decision))
  const calls = f.calls.length
  await assert.rejects(readRecoverySequenceVersion(f.transport, target, '10001'), /Invalid/)
  await assert.rejects(readUnverifiedRecoverySequence(f.transport, target, '10001', nonce), /Invalid/)
  assert.equal(f.calls.length, calls)
  const inspected = await inspectRecoverySequenceVersionOutsideScanLimit(f.transport, target, '10001')
  assert.deepEqual(Buffer.from(inspected.payload), Buffer.from(decision))
  assert.equal(inspected.coverageVerified, false)
  await assert.rejects(inspectRecoverySequenceVersionOutsideScanLimit(f.transport, target, '10000'), /Invalid/)
  await assert.rejects(inspectRecoverySequenceVersionOutsideScanLimit(f.transport, target, '01'), /Invalid/)
  const longVersion = '90071992547409931234'
  const exact = { async request(method, path) {
    assert.equal(method, 'GET')
    assert.equal(path, `projects/${target.projectNumber}/secrets/${target.secretId}/versions/${longVersion}:access`)
    return { status: 200, data: { name: path.slice(0, -7), payload: { data: Buffer.from(decision).toString('base64'), dataCrc32c: crc(decision) } } }
  } }
  assert.deepEqual(Buffer.from((await inspectRecoverySequenceVersionOutsideScanLimit(exact, target, longVersion)).payload), Buffer.from(decision))
})

test('separate writer and reader must agree on the exact appended bytes', async () => {
  const f = fake()
  const writer = { async request(method, ...args) { assert.equal(method, 'POST'); return f.transport.request(method, ...args) } }
  const reader = { async request(method, ...args) { assert.equal(method, 'GET'); return f.transport.request(method, ...args) } }
  assert.deepEqual(await appendAndVerifyRecoverySequenceVersion(writer, reader, target, baseline), { version: '1', coverageVerified: false })
  const denied = { async request() { return { status: 403, data: {} } } }
  await assert.rejects(appendAndVerifyRecoverySequenceVersion(writer, denied, target, decision), /outcome is uncertain/)
  assert.equal(f.versions.length, 2)
  assert.deepEqual(f.versions[1], Buffer.from(decision))
})

test('sequence suppression requires every selected version and never asserts coverage', async () => {
  const f = fake()
  for (const bytes of [baseline, decision, fence]) await appendRecoverySequenceVersion(f.transport, target, bytes)
  const calls = []
  const client = { async query(statement, parameters) {
    calls.push({ statement, parameters })
    return { rows: statement.startsWith('SELECT * FROM public.suppress_restored_removals') ? [{ matched: 1, absent: 0 }] : [] }
  }, release() {} }
  const pool = { async connect() { return client } }
  const mutableTarget = { ...target }
  const reader = { async request(...args) {
    mutableTarget.environment = 'prod'; mutableTarget.secretId = 'other-journal'
    return f.transport.request(...args)
  } }
  assert.deepEqual(await suppressKnownRemovalsFromSequence(reader, mutableTarget, '3', nonce, pool),
    { matched: 1, absent: 0, reviewOperations: 1, coverageVerified: false })
  assert.deepEqual(calls.find(call => call.parameters)?.parameters, [['44444444-4444-4444-8444-444444444444']])
  f.versions[1] = undefined
  let connected = false
  await assert.rejects(suppressKnownRemovalsFromSequence(f.transport, target, '3', nonce,
    { async connect() { connected = true; throw new Error('unexpected database access') } }), /could not be verified/)
  assert.equal(connected, false)
})
