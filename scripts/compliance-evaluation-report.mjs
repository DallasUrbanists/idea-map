// Offline reporting only. This does not define an accepted scoring method or gate.
import { shortcutEligible } from './compliance-candidate.mjs'

export function summarizeEvaluation(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Evaluation rows required')
  const ids = new Set()
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.group !== 'string' || !row.group ||
      ![0, 1, null].includes(row.reference) ||
      !(row.state === 'unavailable' && row.score === null || row.state === 'scored' && Number.isFinite(row.score) && row.score >= 0 && row.score <= 100)) {
      throw new Error('Invalid evaluation row')
    }
    ids.add(row.id)
  }
  const scored = rows.filter(row => row.state === 'scored')
  const violations = scored.filter(row => row.reference === 0)
  const compliant = rows.filter(row => row.reference === 1)
  const shortcutViolations = Array.from({ length: 11 }, (_, priorApprovals) => ({
    priorApprovals,
    eligible: violations.filter(row => shortcutEligible(row.score, true, priorApprovals)).length,
  }))
  const groups = Object.fromEntries([...new Set(rows.map(row => row.group))].sort().map(group => {
    const members = rows.filter(row => row.group === group)
    return [group, { cases: members.length, unavailable: members.filter(row => row.state === 'unavailable').length,
      labelledViolations: members.filter(row => row.reference === 0).length,
      labelledCompliant: members.filter(row => row.reference === 1).length,
      incompleteScored: members.filter(row => row.reference === null && row.state === 'scored').length,
      violatingEligibleForAutomaticApproval: members.filter(row => row.reference === 0 && row.state === 'scored' && row.score >= 60).length,
      compliantSentToHumanReview: members.filter(row => row.reference === 1 && (row.state === 'unavailable' || row.score < 60)).length }]
  }))
  return {
    cases: rows.length,
    scored: scored.length,
    unavailable: rows.length - scored.length,
    incompleteScored: scored.filter(row => row.reference === null).length,
    eligibleForAutomaticApproval: scored.filter(row => row.score >= 60).length,
    requiringHumanReviewOrUnavailable: rows.filter(row => row.state === 'unavailable' || row.score < 60).length,
    violatingEligibleForAutomaticApproval: violations.filter(row => row.score >= 60).length,
    violatingEligibleForInstantApproval: violations.filter(row => row.score >= 95).length,
    compliantSentToHumanReview: compliant.filter(row => row.state === 'unavailable' || row.score < 60).length,
    shortcutViolations,
    groups,
  }
}
