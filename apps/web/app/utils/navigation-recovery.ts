/** Synthetic navigation context only; never put draft content in this model. */
export interface BrowseContext {
  readonly viewport: {
    readonly latitude: number
    readonly longitude: number
    readonly zoom: number
  }
  readonly listOffset: number
}

export type NavigationView = 'browse' | 'detail' | 'submit'
export interface NavigationState {
  readonly view: NavigationView
  readonly browse: BrowseContext | null
  readonly submitStep: 'locate' | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readBrowse(value: unknown): BrowseContext | null {
  const browse = record(value)
  const viewport = record(browse?.viewport)
  if (!browse || !viewport || !finite(viewport.latitude) || viewport.latitude < -90 || viewport.latitude > 90 ||
      !finite(viewport.longitude) || viewport.longitude < -180 || viewport.longitude > 180 ||
      !finite(viewport.zoom) || viewport.zoom < 0 || !finite(browse.listOffset) || browse.listOffset < 0) {
    return null
  }
  return {
    viewport: { latitude: viewport.latitude, longitude: viewport.longitude, zoom: viewport.zoom },
    listOffset: browse.listOffset
  }
}

/** Parse a history-like snapshot, dropping unknown fields and malformed browse context. */
export function restoreNavigation(saved?: unknown): NavigationState {
  const snapshot = record(saved)
  const view = snapshot?.view
  const browse = readBrowse(snapshot?.browse)
  if (view === 'detail') return { view, browse, submitStep: null }
  if (view === 'submit' && snapshot?.submitStep === 'locate') {
    return { view, browse, submitStep: 'locate' }
  }
  return { view: 'browse', browse, submitStep: null }
}

/** Capture a complete browse context only while browsing; invalid captures are ignored. */
export function captureBrowse(state: NavigationState, context: unknown): NavigationState {
  const copy = restoreNavigation(state)
  const browse = readBrowse(context)
  return copy.view === 'browse' && browse ? { ...copy, browse } : copy
}

export function openDetail(state: NavigationState): NavigationState {
  const copy = restoreNavigation(state)
  return copy.view === 'browse' ? { ...copy, view: 'detail' } : copy
}

export function returnToBrowse(state: NavigationState): NavigationState {
  const copy = restoreNavigation(state)
  return { ...copy, view: 'browse', submitStep: null }
}

/** Entering Submit from Browse intentionally starts at Locate. */
export function enterSubmitFromBrowse(state: NavigationState): NavigationState {
  const copy = restoreNavigation(state)
  return copy.view === 'browse' ? { ...copy, view: 'submit', submitStep: 'locate' } : copy
}
