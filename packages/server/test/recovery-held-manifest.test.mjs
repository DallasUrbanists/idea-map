import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { decodeUnverifiedHeldManifest, encodeUnverifiedHeldManifest, matchUnverifiedHeldManifest } from '../dist/recovery-held-manifest.js'
import { decodeRecoveryRecord, encodeRecoveryHoldManifestConfirmation, encodeRecoveryIntent } from '../dist/recovery-journal-record.js'
import { summarizeUnverifiedRecovery } from '../dist/recovery-journal-plan.js'

const operationId = '11111111-1111-4111-8111-111111111111'
const ideaId = '22222222-2222-4222-8222-222222222222'
const actorId = '33333333-3333-4333-8333-333333333333'
const holdId = '44444444-4444-4444-8444-444444444444'
const authorityId = '55555555-5555-4555-8555-555555555555'
const entry = { kind: 'revision', sourceId: '66666666-6666-4666-8666-666666666666', sourceGeneration: null,
  artifactId: '77777777-7777-4777-8777-777777777777', generation: '90071992547409931234', size: 42, sha256: 'a'.repeat(64) }
const input = { environment: 'dev', operationId, ideaId, holdId, entries: [entry] }
const intent = encodeRecoveryIntent({ environment: 'dev', operationId, ideaId, actorId, authorizedAt: '2026-11-03T12:00:00.000Z',
  decision: { kind: 'hold_placement', caseReference: 'synthetic case', reason: 'synthetic reason',
    authorizationReference: 'synthetic authority', scope: 'synthetic scope' } })
const authority = { actorId, authority: 'executive_director', grantedBy: actorId,
  grantedAt: '2026-11-03T11:59:00.000000Z', authorizationReference: 'synthetic authority' }
const confirmationFor = (manifestBytes, overrides = {}) => encodeRecoveryHoldManifestConfirmation(operationId, 'dev',
  '2026-11-03T12:01:00.000Z', holdId, authorityId, '2026-11-03T12:00:00.123456Z', authority,
  { artifactId: '88888888-8888-4888-8888-888888888888', generation: '42', size: manifestBytes.length,
    sha256: createHash('sha256').update(manifestBytes).digest('hex'), ...overrides })

test('canonical held manifests bind selected artifacts to a known hold without claiming coverage', () => {
  const manifestBytes = encodeUnverifiedHeldManifest(input)
  assert.deepEqual(decodeUnverifiedHeldManifest(manifestBytes, 'dev'), input)
  const confirmation = confirmationFor(manifestBytes)
  assert.equal(decodeRecoveryRecord(confirmation, 'dev').version, 3)
  const match = matchUnverifiedHeldManifest(intent, confirmation, manifestBytes, 'dev')
  assert.deepEqual(match.manifest, input)
  assert.equal(match.coverageVerified, false)
  const summary = summarizeUnverifiedRecovery([intent, confirmation], 'dev')
  assert.equal(summary.holdIdentities[0].heldManifest.sha256, match.heldManifest.sha256)
  assert.deepEqual(summary.reviewOperations, [operationId])
})

test('manifest canonicalization and scope references reject duplicates and ambiguity', () => {
  const media = { ...entry, kind: 'media', sourceId: '99999999-9999-4999-8999-999999999999', sourceGeneration: '55',
    artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  const first = encodeUnverifiedHeldManifest({ ...input, entries: [entry, media] })
  const second = encodeUnverifiedHeldManifest({ ...input, entries: [media, entry] })
  assert.deepEqual(first, second)
  assert.throws(() => encodeUnverifiedHeldManifest({ ...input, entries: [entry, entry] }), /Invalid/)
  assert.throws(() => encodeUnverifiedHeldManifest({ ...input, entries: [entry, { ...media, artifactId: entry.artifactId }] }), /Invalid/)
  assert.throws(() => encodeUnverifiedHeldManifest({ ...input, entries: [{ ...entry, sourceGeneration: '1' }] }), /Invalid/)
  assert.throws(() => encodeUnverifiedHeldManifest({ ...input, entries: [{ ...media, sourceGeneration: null }] }), /Invalid/)
  assert.throws(() => decodeUnverifiedHeldManifest(first, 'prod'), /invalid or incompatible/)
  assert.throws(() => decodeUnverifiedHeldManifest(Buffer.from(`${first.toString()} `), 'dev'), /invalid or incompatible/)
})

test('manifest mismatch, hold mismatch, and malformed confirmation fail without exposing content', () => {
  const bytes = encodeUnverifiedHeldManifest(input), confirmation = confirmationFor(bytes)
  const altered = Buffer.from(bytes); altered[altered.length - 2] ^= 1
  assert.throws(() => matchUnverifiedHeldManifest(intent, confirmation, altered, 'dev'), /could not be reconciled/)
  const otherHold = encodeUnverifiedHeldManifest({ ...input, holdId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
  assert.throws(() => matchUnverifiedHeldManifest(intent, confirmationFor(otherHold), otherHold, 'dev'), /could not be reconciled/)
  assert.throws(() => matchUnverifiedHeldManifest(intent, confirmationFor(bytes, { artifactId: entry.artifactId }), bytes, 'dev'), /could not be reconciled/)
  assert.throws(() => confirmationFor(bytes, { generation: '01' }), /Invalid/)
  assert.throws(() => confirmationFor(bytes, { artifactId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa' }), /Invalid/)
  assert.throws(() => matchUnverifiedHeldManifest(intent, confirmation, bytes, 'prod'), /could not be reconciled/)
})
