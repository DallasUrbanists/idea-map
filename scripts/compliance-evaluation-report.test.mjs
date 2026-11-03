import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeEvaluation } from './compliance-evaluation-report.mjs'

const row = (id, reference, score, group = 'synthetic') => ({ id, group, reference, state: score === null ? 'unavailable' : 'scored', score })

test('report exposes unsafe scores, unavailable examples, and every shortcut threshold without rounding', () => {
  const report = summarizeEvaluation([
    row('below', 0, 59.99), row('boundary', 0, 60), row('trusted-equality', 0, 90),
    row('trusted-above', 0, 90.01), row('instant', 0, 95), row('good-unavailable', 1, null),
    row('good-flagged', 1, 40), row('incomplete-scored', null, 98, 'incomplete'),
    row('incomplete-unavailable', null, null, 'incomplete'),
  ])
  assert.equal(report.violatingEligibleForAutomaticApproval, 4)
  assert.equal(report.labelledViolations, 5)
  assert.equal(report.zeroKnownMisses, false)
  assert.equal(report.violatingEligibleForInstantApproval, 1)
  assert.equal(report.shortcutViolations[0].eligible, 0)
  assert.equal(report.shortcutViolations[9].eligible, 1)
  assert.equal(report.shortcutViolations[10].eligible, 2)
  assert.equal(report.incompleteScored, 1)
  assert.equal(report.compliantSentToHumanReview, 2)
  assert.deepEqual(report.groups.incomplete, { cases: 2, unavailable: 1, labelledViolations: 0, labelledCompliant: 0,
    incompleteScored: 1, violatingEligibleForAutomaticApproval: 0, compliantSentToHumanReview: 0 })
})

test('a set with no labelled violations cannot demonstrate zero known misses', () => {
  assert.equal(summarizeEvaluation([row('compliant', 1, 80)]).zeroKnownMisses, null)
  assert.equal(summarizeEvaluation([row('manual', 0, null)]).zeroKnownMisses, true)
})

test('invalid, duplicate, or internally inconsistent evidence cannot produce a report', () => {
  for (const invalid of [[], [row('same', 1, 80), row('same', 0, 90)], [row('bad', 0, NaN)],
    [{ ...row('bad', null, null), score: 50 }], [{ ...row('bad', 0, 70), reference: 'unknown' }]]) {
    assert.throws(() => summarizeEvaluation(invalid), /Evaluation rows required|Invalid evaluation row/)
  }
})
