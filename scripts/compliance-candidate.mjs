// Research-only candidate. It must not be used for publication or provider calls.
const likelihoods = ['VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY']

function features(kind, signals) {
  if (kind === 'text') {
    if (!Array.isArray(signals) || signals.length !== 4 || signals.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return null
    return [1, ...signals]
  }
  if (kind === 'image') {
    if (!Array.isArray(signals) || signals.length !== 2 || signals.some(value => !likelihoods.includes(value))) return null
    return [1, ...signals.flatMap(value => likelihoods.map(level => Number(level === value)))]
  }
  return null
}

function predict(weights, vector) {
  const z = weights.reduce((sum, weight, index) => sum + weight * vector[index], 0)
  return 1 / (1 + Math.exp(-z))
}

/** Train deterministic illustrative models on labelled synthetic provider outputs. */
export function trainCandidate(examples) {
  const models = {}
  for (const kind of ['text', 'image']) {
    const rows = examples.filter(example => example.kind === kind).map(example => ({ vector: features(kind, example.signals), label: example.label }))
    if (!rows.length || rows.some(row => !row.vector || ![0, 1].includes(row.label)) || new Set(rows.map(row => row.label)).size !== 2) throw new Error(`Invalid ${kind} training data`)
    const weights = Array(rows[0].vector.length).fill(0)
    for (let step = 0; step < 2000; step++) {
      const gradient = weights.map(() => 0)
      for (const row of rows) {
        const error = predict(weights, row.vector) - row.label
        row.vector.forEach((value, index) => { gradient[index] += error * value / rows.length })
      }
      weights.forEach((weight, index) => { weights[index] -= 0.2 * (gradient[index] + (index ? 0.01 * weight : 0)) })
    }
    models[kind] = weights
  }
  return models
}

/** Fail closed unless every required component and policy check is represented. */
export function assessCandidate(models, item) {
  if (!models || typeof models !== 'object' || !item || typeof item !== 'object' || item.coverage !== 'complete' || !['en', 'es'].includes(item.language) ||
    !Array.isArray(item.images) || !Number.isInteger(item.expectedImages) || item.expectedImages < 0 || item.images.length !== item.expectedImages) {
    return { state: 'unavailable', score: null }
  }
  const inputs = [{ kind: 'text', signals: item.text }, ...item.images.map(signals => ({ kind: 'image', signals }))]
  const scores = []
  for (const input of inputs) {
    const vector = features(input.kind, input.signals)
    if (!vector || !Array.isArray(models[input.kind]) || models[input.kind].length !== vector.length || models[input.kind].some(value => !Number.isFinite(value))) {
      return { state: 'unavailable', score: null }
    }
    scores.push(100 * predict(models[input.kind], vector))
  }
  return { state: 'scored', score: Math.min(...scores) }
}

/** Apply the adopted standard schedule to a score, without display rounding. */
export function standardWaitMilliseconds(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid score')
  if (score < 60) return null
  if (score >= 95) return 0
  return Math.ceil(86_400_000 * (95 - score) / 35)
}

/** A shortcut requires verified ownership and a strictly higher score. */
export function shortcutEligible(score, verifiedOwner, priorApprovals) {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid shortcut evidence')
  if (verifiedOwner !== true || priorApprovals == null) return false
  if (!Number.isSafeInteger(priorApprovals) || priorApprovals < 0) throw new Error('Invalid shortcut evidence')
  return verifiedOwner === true && score > 95 - 0.5 * Math.min(priorApprovals, 10)
}
