// Hand-authored synthetic labels and fake provider outputs; these are not provider observations.
export const training = [
  ...[
    [[0.02, 0.02, 0.04, 0.02], 1], [[0.08, 0.05, 0.12, 0.02], 1],
    [[0.15, 0.08, 0.25, 0.03], 1], [[0.04, 0.12, 0.31, 0.03], 1],
    [[0.24, 0.18, 0.18, 0.06], 1], [[0.12, 0.10, 0.46, 0.02], 1],
    [[0.91, 0.83, 0.42, 0.02], 0], [[0.84, 0.72, 0.70, 0.03], 0],
    [[0.75, 0.54, 0.88, 0.02], 0], [[0.66, 0.70, 0.39, 0.05], 0],
    [[0.30, 0.20, 0.20, 0.92], 0], [[0.53, 0.45, 0.80, 0.02], 0],
  ].map(([signals, label]) => ({ kind: 'text', signals, label })),
  ...[
    [['VERY_UNLIKELY', 'VERY_UNLIKELY'], 1], [['UNLIKELY', 'VERY_UNLIKELY'], 1],
    [['VERY_UNLIKELY', 'UNLIKELY'], 1], [['UNLIKELY', 'UNLIKELY'], 1],
    [['POSSIBLE', 'VERY_UNLIKELY'], 1], [['VERY_UNLIKELY', 'POSSIBLE'], 1],
    [['VERY_LIKELY', 'VERY_UNLIKELY'], 0], [['LIKELY', 'UNLIKELY'], 0],
    [['VERY_UNLIKELY', 'VERY_LIKELY'], 0], [['UNLIKELY', 'LIKELY'], 0],
    [['POSSIBLE', 'VERY_LIKELY'], 0], [['VERY_LIKELY', 'POSSIBLE'], 0],
  ].map(([signals, label]) => ({ kind: 'image', signals, label })),
]

const harmless = [0.08, 0.05, 0.08, 0.02]
const safeImage = ['VERY_UNLIKELY', 'VERY_UNLIKELY']
const complete = { coverage: 'complete', language: 'en', expectedImages: 0, images: [], text: harmless }
export const evaluation = [
  { id: 'civic-criticism', group: 'civic', reference: 1, ...complete, text: [0.56, 0.43, 0.20, 0.03] },
  { id: 'unsafe-street-discussion', group: 'civic', reference: 1, ...complete, text: [0.09, 0.06, 0.74, 0.02] },
  { id: 'spanish-civic', group: 'multilingual', reference: 1, ...complete, language: 'es', text: [0.12, 0.05, 0.20, 0.02] },
  { id: 'fictitious-harassment', group: 'violation', reference: 0, ...complete, text: [0.88, 0.77, 0.32, 0.02] },
  { id: 'low-signal-threat', group: 'violation', reference: 0, ...complete, text: [0.12, 0.08, 0.18, 0.02] },
  { id: 'two-safe-images', group: 'images', reference: 1, ...complete, expectedImages: 2, images: [safeImage, ['UNLIKELY', 'UNLIKELY']] },
  { id: 'one-unsafe-image', group: 'images', reference: 0, ...complete, expectedImages: 2, images: [safeImage, ['VERY_LIKELY', 'VERY_UNLIKELY']] },
  { id: 'missing-photo', group: 'incomplete', reference: null, ...complete, expectedImages: 2, images: [safeImage] },
  { id: 'unknown-image-result', group: 'incomplete', reference: null, ...complete, expectedImages: 1, images: [['UNKNOWN', 'UNLIKELY']] },
  { id: 'provider-failure', group: 'incomplete', reference: null, ...complete, text: null },
  { id: 'unsupported-language', group: 'incomplete', reference: null, ...complete, language: 'fr' },
  { id: 'unassessed-rights', group: 'incomplete', reference: null, ...complete, coverage: 'incomplete' },
]
