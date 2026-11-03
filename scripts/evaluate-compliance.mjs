import { trainCandidate, assessCandidate } from './compliance-candidate.mjs'
import { training, evaluation } from './compliance-fixtures.mjs'
import { summarizeEvaluation } from './compliance-evaluation-report.mjs'

const models = trainCandidate(training)
const rows = evaluation.map(item => ({ id: item.id, group: item.group, reference: item.reference, ...assessCandidate(models, item) }))
const metrics = summarizeEvaluation(rows)
process.stdout.write(`${JSON.stringify({ method: 'synthetic-logistic-v0', metrics, rows }, null, 2)}\n`)
