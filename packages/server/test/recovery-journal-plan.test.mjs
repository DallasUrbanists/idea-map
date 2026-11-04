import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareUnverifiedRecoveryCheckpoint, summarizeUnverifiedRecovery } from '../dist/recovery-journal-plan.js'
import { encodeRecoveryConfirmation, encodeRecoveryHoldConfirmation, encodeRecoveryIntent } from '../dist/recovery-journal-record.js'

const operation = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
const idea = '22222222-2222-4222-8222-222222222222'
const base = { environment: 'dev', ideaId: idea, actorId: '33333333-3333-4333-8333-333333333333', authorizedAt: '2026-11-03T12:00:00.000Z' }
const hold = { kind: 'hold_placement', caseReference: 'synthetic case', reason: 'synthetic reason',
  authorizationReference: 'synthetic authority', scope: 'synthetic scope' }
const intent = (id, decision) => encodeRecoveryIntent({ ...base, operationId: operation(id), decision })
const confirmation = id => encodeRecoveryConfirmation(operation(id), 'dev', '2026-11-03T12:01:00.000Z')
const assignment = { actorId: base.actorId, authority: 'executive_director', grantedBy: base.actorId,
  grantedAt: '2026-11-03T11:59:00.000000Z', authorizationReference: 'synthetic authority' }

test('recovery summary protects uncertain removals and holds and never applies a release', () => {
  const records = [
    confirmation(1), intent(1, { kind: 'removal', classification: 'other', reason: 'synthetic reason' }),
    intent(2, hold), intent(3, { ...hold, kind: 'hold_release', holdId: '44444444-4444-4444-8444-444444444444', legalReviewReference: null }),
    confirmation(3), confirmation(4),
  ]
  assert.deepEqual(summarizeUnverifiedRecovery(records, 'dev'), {
    removals: [idea], holdPlacements: [idea], holdReviewIdeas: [idea], holdIdentities: [], reviewOperations: [operation(2), operation(3), operation(4)],
    unmatchedConfirmations: 1, coverageVerified: false,
  })
  assert.equal(summarizeUnverifiedRecovery([], 'dev').coverageVerified, false)
})

test('a release without its placement still identifies an idea requiring hold review', () => {
  const release = { ...hold, kind: 'hold_release', holdId: '44444444-4444-4444-8444-444444444444', legalReviewReference: null }
  const result = summarizeUnverifiedRecovery([intent(1, release), confirmation(1)], 'dev')
  assert.deepEqual(result.holdPlacements, [])
  assert.deepEqual(result.holdReviewIdeas, [idea])
  assert.deepEqual(result.reviewOperations, [operation(1)])
  assert.equal(result.coverageVerified, false)
})
test('recovery summary rejects duplicate, incompatible, or incorrectly ordered evidence', () => {
  const decision = intent(1, { kind: 'removal', classification: 'other', reason: 'synthetic reason' })
  assert.throws(() => summarizeUnverifiedRecovery([decision, decision], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([confirmation(1), confirmation(1)], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([decision, encodeRecoveryConfirmation(operation(1), 'dev', '2026-11-03T11:59:00.000Z')], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([decision], 'prod'), /invalid or incompatible/)
  assert.throws(() => summarizeUnverifiedRecovery([], 'other'), /invalid/)
})

test('hold placement confirmations preserve the committed hold ID and reject ambiguous associations', () => {
  const holdId = '44444444-4444-4444-8444-444444444444'
  const authority = '55555555-5555-4555-8555-555555555555'
  const placedAt = '2026-11-03T12:00:00.123456Z'
  const held = id => encodeRecoveryHoldConfirmation(operation(id), 'dev', '2026-11-03T12:01:00.000Z', holdId, authority, placedAt, assignment)
  assert.deepEqual(summarizeUnverifiedRecovery([intent(1, hold), confirmation(1)], 'dev').reviewOperations, [operation(1)])
  const result = summarizeUnverifiedRecovery([intent(1, hold), held(1)], 'dev')
  assert.deepEqual(result.reviewOperations, [operation(1)])
  assert.deepEqual(result.holdIdentities, [{ operationId: operation(1), ideaId: idea, holdId, placementAuthorityId: authority, placedAt, authorityEvidence: assignment }])
  assert.equal(result.coverageVerified, false)
  assert.throws(() => summarizeUnverifiedRecovery([intent(1, hold), held(1), intent(2, hold), held(2)], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([intent(1, { kind: 'removal', classification: 'other', reason: 'synthetic' }), held(1)], 'dev'), /ambiguous/)
})

test('conflicting idea associations for a hold ID fail closed in either record order', () => {
  const holdId = '44444444-4444-4444-8444-444444444444'
  const otherIdea = '55555555-5555-4555-8555-555555555555'
  const release = { ...hold, kind: 'hold_release', holdId, legalReviewReference: null }
  const otherRelease = encodeRecoveryIntent({ ...base, ideaId: otherIdea, operationId: operation(2), decision: release })
  const placement = [intent(1, hold), encodeRecoveryHoldConfirmation(operation(1), 'dev', '2026-11-03T12:01:00.000Z', holdId, '66666666-6666-4666-8666-666666666666', '2026-11-03T12:00:00.000000Z', assignment)]
  assert.throws(() => summarizeUnverifiedRecovery([...placement, otherRelease], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([otherRelease, ...placement], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([intent(1, release), otherRelease], 'dev'), /ambiguous/)
  assert.doesNotThrow(() => summarizeUnverifiedRecovery([...placement, intent(2, release)], 'dev'))
})

test('a hold ID cannot identify conflicting case references in either record order', () => {
  const holdId = '44444444-4444-4444-8444-444444444444'
  const authority = '66666666-6666-4666-8666-666666666666'
  const placement = [intent(1, { ...hold, caseReference: ' synthetic case ' }),
    encodeRecoveryHoldConfirmation(operation(1), 'dev', '2026-11-03T12:01:00.000Z', holdId, authority,
      '2026-11-03T12:00:00.000000Z', assignment)]
  const release = { ...hold, kind: 'hold_release', holdId, legalReviewReference: null }
  assert.doesNotThrow(() => summarizeUnverifiedRecovery([...placement, intent(2, release)], 'dev'))
  const conflicting = intent(2, { ...release, caseReference: 'different synthetic case' })
  assert.throws(() => summarizeUnverifiedRecovery([...placement, conflicting], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([conflicting, ...placement], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([intent(1, release), conflicting], 'dev'), /ambiguous/)
})

test('unmatched confirmations identify operations needing review without inventing affected ideas', () => {
  const holdId = '44444444-4444-4444-8444-444444444444'
  const result = summarizeUnverifiedRecovery([
    encodeRecoveryHoldConfirmation(operation(2), 'dev', '2026-11-03T12:01:00.000Z', holdId, '66666666-6666-4666-8666-666666666666', '2026-11-03T12:00:00.000000Z', assignment),
    confirmation(1),
  ], 'dev')
  assert.deepEqual(result.reviewOperations, [operation(1), operation(2)])
  assert.deepEqual(result.removals, [])
  assert.deepEqual(result.holdReviewIdeas, [])
  assert.deepEqual(result.holdIdentities, [])
  assert.equal(result.unmatchedConfirmations, 2)
  assert.equal(result.coverageVerified, false)
})

test('checkpoint comparison exposes missing, changed, and additional exact generations without asserting coverage', () => {
  const reference = (n, generation) => ({ recordId: operation(n), generation, metageneration: '1', crc32c: 'AAAAAA==' })
  const checkpoint = [reference(2, '90071992547409931234'), reference(1, '1'), reference(3, '3')]
  const inventory = [reference(4, '4'), reference(2, '90071992547409931235'), reference(1, '1')]
  assert.deepEqual(compareUnverifiedRecoveryCheckpoint(checkpoint, inventory), {
    missing: [operation(3)], changed: [operation(2)], additional: [operation(4)], coverageVerified: false,
  })
  assert.equal(compareUnverifiedRecoveryCheckpoint([], []).coverageVerified, false)
  assert.deepEqual(compareUnverifiedRecoveryCheckpoint([reference(1, '1')], [{ ...reference(1, '1'), metageneration: '2' }]).changed, [operation(1)])
  assert.deepEqual(compareUnverifiedRecoveryCheckpoint([reference(1, '1')], [{ ...reference(1, '1'), crc32c: 'BBBBBB==' }]).changed, [operation(1)])
  assert.throws(() => compareUnverifiedRecoveryCheckpoint([reference(1, '1'), reference(1, '2')], []), /invalid/)
  assert.throws(() => compareUnverifiedRecoveryCheckpoint([], [reference(1, '01')]), /invalid/)
  assert.throws(() => compareUnverifiedRecoveryCheckpoint([], [{ ...reference(1, '1'), extra: true }]), /invalid/)
  assert.throws(() => compareUnverifiedRecoveryCheckpoint([], [reference(1, '1'.repeat(21))]), /invalid/)
})

test('hold evidence identifies the original authority and placement time for review', () => {
  const holdId = '44444444-4444-4444-8444-444444444444'
  const authority = '55555555-5555-4555-8555-555555555555'
  const placedAt = '2026-11-03T12:00:00.123456Z'
  const evidence = encodeRecoveryHoldConfirmation(operation(1), 'dev', '2026-11-03T12:01:00.000Z', holdId, authority, placedAt, assignment)
  const result = summarizeUnverifiedRecovery([intent(1, hold), evidence], 'dev')
  assert.deepEqual(result.holdIdentities, [{ operationId: operation(1), ideaId: idea, holdId,
    placementAuthorityId: authority, placedAt, authorityEvidence: assignment }])
  assert.deepEqual(result.reviewOperations, [operation(1)])
  assert.equal(result.coverageVerified, false)
  const premature = encodeRecoveryHoldConfirmation(operation(1), 'dev', '2026-11-03T12:01:00.000Z', holdId, authority, '2026-11-03T11:59:59.999999Z', assignment)
  assert.throws(() => summarizeUnverifiedRecovery([intent(1, hold), premature], 'dev'), /ambiguous/)
  const wrongActor = encodeRecoveryHoldConfirmation(operation(1), 'dev', '2026-11-03T12:01:00.000Z',
    holdId, authority, placedAt, { ...assignment, actorId: '66666666-6666-4666-8666-666666666666' })
  assert.throws(() => summarizeUnverifiedRecovery([intent(1, hold), wrongActor], 'dev'), /ambiguous/)
  const differentReference = encodeRecoveryHoldConfirmation(operation(1), 'dev', '2026-11-03T12:01:00.000Z',
    holdId, authority, placedAt, { ...assignment, authorizationReference: 'different assignment reference' })
  assert.deepEqual(summarizeUnverifiedRecovery([intent(1, hold), differentReference], 'dev').reviewOperations, [operation(1)])
})

test('one immutable authority assignment cannot describe conflicting grant facts', () => {
  const authority = '55555555-5555-4555-8555-555555555555'
  const make = (n, holdId, facts) => encodeRecoveryHoldConfirmation(operation(n), 'dev', '2026-11-03T12:01:00.000Z',
    holdId, authority, '2026-11-03T12:00:00.123456Z', facts)
  const first = [intent(1, hold), make(1, '44444444-4444-4444-8444-444444444444', assignment)]
  const secondIntent = intent(2, hold)
  const secondHold = '77777777-7777-4777-8777-777777777777'
  assert.doesNotThrow(() => summarizeUnverifiedRecovery([...first, secondIntent, make(2, secondHold, assignment)], 'dev'))
  const inconsistent = { ...assignment, grantedBy: '66666666-6666-4666-8666-666666666666' }
  assert.throws(() => summarizeUnverifiedRecovery([...first, secondIntent, make(2, secondHold, inconsistent)], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([secondIntent, make(2, secondHold, inconsistent), ...first], 'dev'), /ambiguous/)
})
