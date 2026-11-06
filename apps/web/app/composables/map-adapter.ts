import type { InjectionKey } from 'vue'
export interface MapPosition { lat: number; lng: number }
export interface MapCamera { center: MapPosition; zoom: number }
export interface MapMarker { id: string; title: string; position: MapPosition }
export interface MapPadding { top: number; right: number; bottom: number; left: number; dragging?: boolean; cornerOverlap?: boolean }
export interface MapPlace { id: string; name: string; address: string; position: MapPosition }
export interface MapPlaceResults { places: MapPlace[]; source: 'google' | 'fixture' }
export interface MapAdapter {
  markers(markers: readonly MapMarker[], selectedId: string | null): void
  reveal(position: MapPosition, padding: MapPadding): void
  searchPlaces(query: string): Promise<MapPlaceResults>
  showPlace(place: MapPlace | null): void
  zoom(value: number): void
  recenter(): void
  mapType(value: 'roadmap' | 'satellite'): void
  resize(): void
  dispose(): void
}
export interface MapAdapterOptions {
  element: HTMLElement; apiKey: string; mapId?: string; center: MapPosition; zoom: number; signal?: AbortSignal
  select: (id: string) => void; camera: (camera: MapCamera) => void
  click: (position: MapPosition) => void; error: () => void
}
export type MapAdapterFactory = (options: MapAdapterOptions) => Promise<MapAdapter>
export const MAP_ADAPTER_FACTORY: InjectionKey<MapAdapterFactory> = Symbol('Map adapter factory')
export const validPosition = (position: MapPosition) => Number.isFinite(position.lat) && Number.isFinite(position.lng) && Math.abs(position.lat) <= 90 && Math.abs(position.lng) <= 180
export function boundedPadding(padding: MapPadding, width: number, height: number): MapPadding {
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
  const x = Math.max(0, width - 44) / Math.max(1, finite(padding.left) + finite(padding.right))
  const y = Math.max(0, height - 44) / Math.max(1, finite(padding.top) + finite(padding.bottom))
  return { left: finite(padding.left) * Math.min(1, x), right: finite(padding.right) * Math.min(1, x), top: finite(padding.top) * Math.min(1, y), bottom: finite(padding.bottom) * Math.min(1, y) }
}
