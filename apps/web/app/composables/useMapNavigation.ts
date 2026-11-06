import { computed, reactive, ref } from 'vue'
import type { MapPosition } from './map-adapter'

export const mapViews = ['map', 'search', 'results', 'idea', 'new-idea', 'saved', 'profile', 'settings', 'menu'] as const
export type MapView = typeof mapViews[number]
export interface MapViewEntry { view: MapView; ideaId?: string; query?: string }
export const isMapView = (value: string): value is MapView => (mapViews as readonly string[]).includes(value)

export function useMapNavigation() {
  const history = ref<MapViewEntry[]>([{ view: 'map' }])
  const current = computed(() => history.value[history.value.length - 1]!)
  const canGoBack = computed(() => history.value.length > 1)
  const query = ref('')
  const draft = reactive<{ title: string; description: string; position: MapPosition | null }>({ title: '', description: '', position: null })
  const selectedIdeaId = ref<string | null>(null)
  const sheetMaximized = ref(false)
  const camera = ref({ center: { lat: 32.7767, lng: -96.797 }, zoom: 13 })
  const scrollPositions = new Map<string, number>()
  const scrollKey = (view: MapView, ideaId?: string, contextQuery = query.value) => `${view}:${view === 'results' || view === 'search' ? contextQuery : ideaId || ''}`
  function close() { history.value = [{ view: 'map' }] }
  function visit(view: MapView, ideaId?: string) {
    if (!isMapView(view)) throw new TypeError('Unknown map view')
    if (view === 'map') { close(); return }
    if (view === 'idea' && !ideaId?.trim()) throw new TypeError('An idea view requires an idea identity')
    const entry: MapViewEntry = view === 'idea' ? { view, ideaId, query: query.value } : { view, query: query.value }
    if (current.value.view !== entry.view || current.value.ideaId !== entry.ideaId || ((view === 'results' || view === 'search') && current.value.query !== entry.query)) history.value.push(entry)
    if (view === 'idea') selectedIdeaId.value = ideaId!
  }
  function back() {
    if (canGoBack.value) history.value.pop()
    if (current.value.view === 'idea') selectedIdeaId.value = current.value.ideaId!
    if (current.value.query !== undefined) query.value = current.value.query
  }
  function setScroll(view: MapView, value: number, ideaId?: string, contextQuery = query.value) {
    if (Number.isFinite(value)) scrollPositions.set(scrollKey(view, ideaId, contextQuery), Math.max(0, value))
  }
  const getScroll = (view: MapView, ideaId?: string, contextQuery = query.value) => scrollPositions.get(scrollKey(view, ideaId, contextQuery)) || 0
  return { current, history, canGoBack, query, draft, selectedIdeaId, sheetMaximized, camera, visit, openIdea: (id: string) => visit('idea', id), back, close, setScroll, getScroll }
}
