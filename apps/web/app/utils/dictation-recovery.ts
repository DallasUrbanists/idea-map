/** Draft versions are supplied by the caller and must change with each edit. */
export interface DraftSnapshot {
  readonly text: string
  readonly revision: string
}

/** Transcript and draft snapshots remain separate until an explicit apply. */
export type DictationState =
  | { readonly phase: 'recording' | 'review'; readonly original: DraftSnapshot; readonly interim: string; readonly final: string }
  | { readonly phase: 'applied'; readonly original: DraftSnapshot; readonly applied: DraftSnapshot }
  | { readonly phase: 'discarded' | 'undone' }

/** A draft change is a proposal that the caller commits only after comparison. */
export type DictationResult =
  | { readonly status: 'ok'; readonly state: DictationState }
  | { readonly status: 'change'; readonly state: DictationState; readonly expected: DraftSnapshot; readonly draft: DraftSnapshot }
  | { readonly status: 'invalid' | 'conflict' | 'unavailable' | 'empty'; readonly state: DictationState | null }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readDraft(value: unknown): DraftSnapshot | null {
  const input = record(value)
  return input && typeof input.text === 'string' && typeof input.revision === 'string' && input.revision.length > 0
    ? { text: input.text, revision: input.revision }
    : null
}

/** Validate untrusted, parsed recovery data and copy only the supported fields. */
export function readDictationState(value: unknown): DictationState | null {
  const input = record(value)
  if (!input) return null
  if (input.phase === 'discarded' || input.phase === 'undone') return { phase: input.phase }
  const original = readDraft(input.original)
  if (!original) return null
  if ((input.phase === 'recording' || input.phase === 'review') && typeof input.interim === 'string' && typeof input.final === 'string') {
    return { phase: input.phase, original, interim: input.interim, final: input.final }
  }
  if (input.phase === 'applied') {
    const applied = readDraft(input.applied)
    if (applied && applied.revision !== original.revision) return { phase: 'applied', original, applied }
  }
  return null
}

/** Serialize only validated recovery state; the caller owns its private storage. */
export function serializeDictation(state: unknown): string | null {
  const valid = readDictationState(state)
  return valid ? JSON.stringify(valid) : null
}

/** Missing, malformed, or unsupported recovery data never produces a draft change. */
export function restoreDictation(saved: unknown): DictationState | null {
  if (typeof saved !== 'string') return null
  try { return readDictationState(JSON.parse(saved)) } catch { return null }
}

/** Snapshot a valid draft without changing it. */
export function startDictation(draft: unknown): DictationResult {
  const original = readDraft(draft)
  return original
    ? { status: 'ok', state: { phase: 'recording', original, interim: '', final: '' } }
    : { status: 'invalid', state: null }
}

/** Replace the separate interim and final transcript values without editing the draft. */
export function updateDictation(state: unknown, interim: unknown, final: unknown): DictationResult {
  const valid = readDictationState(state)
  if (!valid || typeof interim !== 'string' || typeof final !== 'string') return { status: 'invalid', state: valid }
  if (valid.phase !== 'recording') return { status: 'unavailable', state: valid }
  return { status: 'ok', state: { ...valid, interim, final } }
}

/** Freeze transcript updates for review without changing the draft. */
export function reviewDictation(state: unknown): DictationResult {
  const valid = readDictationState(state)
  if (!valid) return { status: 'invalid', state: null }
  if (valid.phase === 'review') return { status: 'ok', state: valid }
  if (valid.phase !== 'recording') return { status: 'unavailable', state: valid }
  return { status: 'ok', state: { ...valid, phase: 'review' } }
}

/** Discard an uncommitted recording or review without changing the draft. */
export function discardDictation(state: unknown): DictationResult {
  const valid = readDictationState(state)
  if (!valid) return { status: 'invalid', state: null }
  if (valid.phase === 'discarded') return { status: 'ok', state: valid }
  if (valid.phase !== 'recording' && valid.phase !== 'review') return { status: 'unavailable', state: valid }
  return { status: 'ok', state: { phase: 'discarded' } }
}

function sameDraft(left: DraftSnapshot, right: DraftSnapshot): boolean {
  return left.revision === right.revision && left.text === right.text
}

/** Propose a caller-reviewed replacement and its recovery state for atomic commit. */
export function applyDictation(state: unknown, current: unknown, replacement: unknown, nextRevision: unknown): DictationResult {
  const valid = readDictationState(state)
  const draft = readDraft(current)
  if (!valid || !draft || typeof replacement !== 'string' || typeof nextRevision !== 'string' || !nextRevision) {
    return { status: 'invalid', state: valid }
  }
  if (valid.phase !== 'review') return { status: 'unavailable', state: valid }
  if (!sameDraft(valid.original, draft)) return { status: 'conflict', state: valid }
  if (nextRevision === draft.revision) return { status: 'invalid', state: valid }
  if (!valid.final.trim()) return { status: 'empty', state: valid }
  const applied = { text: replacement, revision: nextRevision }
  return { status: 'change', expected: draft, draft: { ...applied }, state: { phase: 'applied', original: valid.original, applied } }
}

/** Propose restoring the original only when the applied draft still matches. */
export function undoDictation(state: unknown, current: unknown, nextRevision: unknown): DictationResult {
  const valid = readDictationState(state)
  const draft = readDraft(current)
  if (!valid || !draft || typeof nextRevision !== 'string' || !nextRevision) return { status: 'invalid', state: valid }
  if (valid.phase !== 'applied') return { status: 'unavailable', state: valid }
  if (!sameDraft(valid.applied, draft)) return { status: 'conflict', state: valid }
  if (nextRevision === draft.revision || nextRevision === valid.original.revision) return { status: 'invalid', state: valid }
  return { status: 'change', expected: draft, draft: { text: valid.original.text, revision: nextRevision }, state: { phase: 'undone' } }
}
