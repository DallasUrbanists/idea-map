import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assessCandidate, shortcutEligible, standardWaitMilliseconds, trainCandidate } from './compliance-candidate.mjs'
import { training, evaluation } from './compliance-fixtures.mjs'

test('synthetic candidate is deterministic and incomplete evidence cannot score', () => {
  const first = trainCandidate(training)
  assert.deepEqual(first, trainCandidate(training))
  for (const item of evaluation) {
    const result = assessCandidate(first, item)
    if (item.reference === null) assert.deepEqual(result, { state: 'unavailable', score: null }, item.id)
    else assert.ok(result.state === 'scored' && Number.isFinite(result.score) && result.score >= 0 && result.score <= 100, item.id)
  }
  assert.deepEqual(assessCandidate(first, { ...evaluation[0], text: [NaN, 0, 0, 0] }), { state: 'unavailable', score: null })
  assert.deepEqual(assessCandidate(first, { ...evaluation[0], coverage: 'unknown' }), { state: 'unavailable', score: null })
  assert.deepEqual(assessCandidate(null, evaluation[0]), { state: 'unavailable', score: null })
  assert.deepEqual(assessCandidate(first, null), { state: 'unavailable', score: null })
  assert.throws(() => trainCandidate([{ kind: 'text', signals: [0, 0, 0, 0], label: 1 }]), /Invalid/)
})

test('adopted waiting period and shortcut use exact scores and fail closed', () => {
  assert.equal(standardWaitMilliseconds(59.99), null)
  assert.equal(standardWaitMilliseconds(60), 86_400_000)
  assert.equal(standardWaitMilliseconds(77.5), 43_200_000)
  assert.equal(standardWaitMilliseconds(95), 0)
  assert.equal(standardWaitMilliseconds(98), 0)
  assert.ok(standardWaitMilliseconds(90) >= 86_400_000 * 5 / 35)
  for (const invalid of [NaN, Infinity, -1, 101]) assert.throws(() => standardWaitMilliseconds(invalid), /Invalid/)
  assert.equal(shortcutEligible(92.5, true, 5), false)
  assert.equal(shortcutEligible(92.6, true, 5), true)
  assert.equal(shortcutEligible(90, true, 11), false)
  assert.equal(shortcutEligible(90.1, true, 11), true)
  assert.equal(shortcutEligible(98, false, 10), false)
  assert.equal(shortcutEligible(98, true, null), false)
  assert.throws(() => shortcutEligible(91, true, -1), /Invalid/)
})

test('the least compliant assessed component determines the candidate score', () => {
  const model = trainCandidate(training)
  const item = { ...evaluation.find(value => value.id === 'two-safe-images') }
  const allSafe = assessCandidate(model, item)
  const oneRisky = assessCandidate(model, { ...item, images: [item.images[0], ['VERY_LIKELY', 'VERY_UNLIKELY']] })
  assert.equal(allSafe.state, 'scored')
  assert.equal(oneRisky.state, 'scored')
  assert.ok(oneRisky.score < allSafe.score)
})
