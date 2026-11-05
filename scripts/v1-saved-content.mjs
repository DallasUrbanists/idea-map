/** Inspect synthetic predecessor snapshots without reading or writing browser storage. */
export const savedContentKeys = Object.freeze({
  bookmarks: 'improvement_map_bookmarks_v1',
  actions: 'improvement_map_actions_v1',
  representatives: 'improvement_map_representatives_v1',
})

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const action = value => object(value) && ['key', 'summary', 'instructions', 'reason', 'sourceUrl']
  .every(field => typeof value[field] === 'string')

function validBookmarks(value) {
  return object(value.saved) && Object.entries(value.saved).every(([id, entry]) =>
    object(entry) && object(entry.suggestion) && entry.suggestion.id === id && object(entry.suggestion.content) &&
    typeof entry.suggestion.content.summary === 'string' && timestamp(entry.savedAt))
}

function validActions(value) {
  return object(value.saved) && object(value.hidden) && object(value.generated) &&
    Object.values(value.saved).every(entry => object(entry) && action(entry.action) &&
      typeof entry.suggestionId === 'string' && typeof entry.suggestionSummary === 'string' && timestamp(entry.savedAt)) &&
    Object.values(value.hidden).every(hidden => hidden === true) &&
    Object.values(value.generated).every(entry => object(entry) && typeof entry.fingerprint === 'string' &&
      Array.isArray(entry.actions) && entry.actions.every(action))
}

function validRepresentatives(value) {
  return object(value.saved) && Object.entries(value.saved).every(([id, entry]) => {
    const rep = entry?.representative
    return object(entry) && object(rep) && (typeof rep.id === 'string' || typeof rep.id === 'number') &&
      String(rep.id) === id && typeof rep.name === 'string' && typeof entry.suggestionId === 'string' && timestamp(entry.savedAt)
  })
}

/** Return a parsed copy on success, retaining unknown fields; reject without changing the input. */
export function inspectSavedContent(category, raw) {
  if (!Object.hasOwn(savedContentKeys, category)) return { status: 'unsupported-category' }
  if (raw === null) return { status: 'missing', category }
  if (typeof raw !== 'string') return { status: 'invalid', category }
  let value
  try { value = JSON.parse(raw) } catch { return { status: 'invalid', category } }
  if (!object(value) || !Object.hasOwn(value, 'version')) return { status: 'invalid', category }
  if (value.version !== 1) return { status: 'unsupported-version', category }
  const valid = category === 'bookmarks' ? validBookmarks(value)
    : category === 'actions' ? validActions(value) : validRepresentatives(value)
  return valid ? { status: 'ok', category, version: 1, data: value } : { status: 'invalid', category }
}

/** Read through an explicitly supplied synthetic storage fake; never write to it. */
export function inspectStoredSavedContent(category, storage) {
  if (!Object.hasOwn(savedContentKeys, category)) return { status: 'unsupported-category' }
  try { return inspectSavedContent(category, storage.getItem(savedContentKeys[category])) }
  catch { return { status: 'read-error', category } }
}
