import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeUnverifiedRecovery } from '../dist/recovery-journal-plan.js'
import { encodeRecoveryConfirmation, encodeRecoveryIntent } from '../dist/recovery-journal-record.js'

const operation = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
const idea = '22222222-2222-4222-8222-222222222222'
const base = { environment: 'dev', ideaId: idea, actorId: '33333333-3333-4333-8333-333333333333', authorizedAt: '2026-11-03T12:00:00.000Z' }
const hold = { kind: 'hold_placement', caseReference: 'synthetic case', reason: 'synthetic reason',
  authorizationReference: 'synthetic authority', scope: 'synthetic scope' }
const intent = (id, decision) => encodeRecoveryIntent({ ...base, operationId: operation(id), decision })
const confirmation = id => encodeRecoveryConfirmation(operation(id), 'dev', '2026-11-03T12:01:00.000Z')

test('recovery summary protects uncertain removals and holds and never applies a release', () => {
  const records = [
    confirmation(1), intent(1, { kind: 'removal', classification: 'other', reason: 'synthetic reason' }),
    intent(2, hold), intent(3, { ...hold, kind: 'hold_release', holdId: '44444444-4444-4444-8444-444444444444', legalReviewReference: null }),
    confirmation(3), confirmation(4),
  ]
  assert.deepEqual(summarizeUnverifiedRecovery(records, 'dev'), {
    removals: [idea], holdPlacements: [idea], reviewOperations: [operation(2), operation(3)],
    unmatchedConfirmations: 1, coverageVerified: false,
  })
  assert.equal(summarizeUnverifiedRecovery([], 'dev').coverageVerified, false)
})

test('recovery summary rejects duplicate, incompatible, or incorrectly ordered evidence', () => {
  const decision = intent(1, { kind: 'removal', classification: 'other', reason: 'synthetic reason' })
  assert.throws(() => summarizeUnverifiedRecovery([decision, decision], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([confirmation(1), confirmation(1)], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([decision, encodeRecoveryConfirmation(operation(1), 'dev', '2026-11-03T11:59:00.000Z')], 'dev'), /ambiguous/)
  assert.throws(() => summarizeUnverifiedRecovery([decision], 'prod'), /invalid or incompatible/)
  assert.throws(() => summarizeUnverifiedRecovery([], 'other'), /invalid/)
})
