import { trainCandidate, assessCandidate } from './compliance-candidate.mjs'
import { training, evaluation } from './compliance-fixtures.mjs'

const models = trainCandidate(training)
const rows = evaluation.map(item => ({ id: item.id, group: item.group, reference: item.reference, ...assessCandidate(models, item) }))
const completed = rows.filter(row => row.state === 'scored')
const metrics = {
  cases: rows.length,
  scored: completed.length,
  unavailable: rows.length - completed.length,
  eligibleForAutomaticApproval: completed.filter(row => row.score >= 60).length,
  requiringHumanReviewOrUnavailable: rows.filter(row => row.state === 'unavailable' || row.score < 60).length,
  violatingEligibleForAutomaticApproval: completed.filter(row => row.reference === 0 && row.score >= 60).length,
  violatingEligibleForInstantApproval: completed.filter(row => row.reference === 0 && row.score >= 95).length,
  compliantSentToHumanReview: completed.filter(row => row.reference === 1 && row.score < 60).length,
}
process.stdout.write(`${JSON.stringify({ method: 'synthetic-logistic-v0', metrics, rows }, null, 2)}\n`)
