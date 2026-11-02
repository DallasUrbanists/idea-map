import assert from 'node:assert/strict'
import { test } from 'node:test'
import { standardReviewWaitMilliseconds } from '../dist/moderation-schedule.js'

test('standard review window follows the adopted score bands', () => {
  assert.equal(standardReviewWaitMilliseconds(0), null)
  assert.equal(standardReviewWaitMilliseconds(59.999), null)
  assert.equal(standardReviewWaitMilliseconds(60), 86_400_000)
  assert.equal(standardReviewWaitMilliseconds(68.75), 64_800_000)
  assert.equal(standardReviewWaitMilliseconds(77.5), 43_200_000)
  assert.equal(standardReviewWaitMilliseconds(86.25), 21_600_000)
  assert.equal(standardReviewWaitMilliseconds(95), 0)
  assert.equal(standardReviewWaitMilliseconds(100), 0)
})

test('fractional milliseconds cannot shorten the review window', () => {
  const score = 94.999999
  const exact = 86_400_000 * (95 - score) / 35
  const actual = standardReviewWaitMilliseconds(score)
  assert.ok(actual >= exact)
  assert.ok(actual - exact < 1)
  assert.equal(actual, 3)
})

test('invalid scores cannot produce a deadline', () => {
  for (const value of [NaN, Infinity, -Infinity, -0.1, 100.1, null, undefined, '95']) {
    assert.throws(() => standardReviewWaitMilliseconds(value), /Invalid compliance score/)
  }
})
