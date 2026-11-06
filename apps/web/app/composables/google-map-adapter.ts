/// <reference types="google.maps" />
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { boundedPadding, validPosition, type MapAdapterFactory, type MapMarker, type MapPadding, type MapPosition } from './map-adapter.ts'

let configuredKey: string | undefined
let loading: Promise<[google.maps.MapsLibrary, google.maps.MarkerLibrary]> | undefined
const failures = new Set<() => void>()
let listening = false
function libraries(key: string) {
  if (configuredKey && configuredKey !== key) return Promise.reject(new Error('Maps configuration changed; reload the preview.'))
  const existing = window.google?.maps?.importLibrary
  if (!configuredKey) { if (!existing) setOptions({ key, v: 'quarterly' }); configuredKey = key }
  if (!listening) {
    const host = window as Window & { gm_authFailure?: () => void }
    const previous = host.gm_authFailure
    host.gm_authFailure = () => { for (const fail of failures) fail(); previous?.() }
    listening = true
  }
  if (!loading) {
    const load = existing ? existing.bind(window.google.maps) : importLibrary
    loading = Promise.all([load('maps'), load('marker')]).catch(error => { loading = undefined; throw error })
  }
  return loading
}

export const createGoogleMapAdapter: MapAdapterFactory = async options => {
  if (!options.apiKey.trim() || !validPosition(options.center) || !Number.isFinite(options.zoom)) throw new Error('A development Maps key and valid map center/zoom are required.')
  if (options.signal?.aborted) throw new Error('Map initialization cancelled.')
  const initialCenter = { ...options.center }
  const initialZoom = Math.max(1, Math.min(20, options.zoom))
  let abortHandler: (() => void) | undefined
  let rejectAuth: ((reason: Error) => void) | undefined
  let initialized = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const failure = () => { if (initialized) options.error(); else rejectAuth?.(new Error('Maps authorization failed.')) }
  failures.add(failure)
  let maps: google.maps.MapsLibrary
  let markerLibrary: google.maps.MarkerLibrary
  try {
    ;[maps, markerLibrary] = await Promise.race([
      libraries(options.apiKey),
      new Promise<never>((_, reject) => {
        rejectAuth = reject
        timeout = setTimeout(() => reject(new Error('Maps did not load.')), 20000)
        abortHandler = () => reject(new Error('Map initialization cancelled.'))
        options.signal?.addEventListener('abort', abortHandler, { once: true })
      }),
    ])
  } catch (error) { failures.delete(failure); throw error }
  finally { if (timeout) clearTimeout(timeout); if (abortHandler) options.signal?.removeEventListener('abort', abortHandler) }
  if (options.signal?.aborted) { failures.delete(failure); throw new Error('Map initialization cancelled.') }
  let map: google.maps.Map
  try {
    map = new maps.Map(options.element, { center: initialCenter, zoom: initialZoom, minZoom: 1, maxZoom: 20, mapId: options.mapId || 'DEMO_MAP_ID', mapTypeControl: false, fullscreenControl: false, streetViewControl: false, cameraControl: true, zoomControl: false, clickableIcons: false, gestureHandling: 'greedy', keyboardShortcuts: true })
  } catch (error) { failures.delete(failure); throw error }
  initialized = true
  let disposed = false
  let placeMarker: google.maps.marker.AdvancedMarkerElement | undefined
  const zoomIndicator = document.createElement('span')
  zoomIndicator.className = 'zoom-indicator'
  zoomIndicator.setAttribute('aria-hidden', 'true')
  zoomIndicator.style.cssText = 'padding: 0 6px; color: #000; background: rgba(245,245,245,.7); font: 10px/14px Roboto, Arial, sans-serif; white-space: nowrap;'
  const zoomControls = map.controls[google.maps.ControlPosition.BOTTOM_RIGHT]!
  zoomControls.push(zoomIndicator)
  const updateZoom = () => { zoomIndicator.textContent = `Zoom ${map.getZoom() ?? initialZoom}` }
  updateZoom()
  const listeners: google.maps.MapsEventListener[] = [map.addListener('zoom_changed', updateZoom)]
  const markers = new Map<string, { marker: google.maps.marker.AdvancedMarkerElement; listener: google.maps.MapsEventListener; selected: boolean }>()
  listeners.push(map.addListener('idle', () => {
    const center = map.getCenter()
    const zoom = map.getZoom()
    if (!disposed && center && zoom !== undefined) options.camera({ center: center.toJSON(), zoom })
  }))
  listeners.push(map.addListener('click', (event: google.maps.MapMouseEvent) => { if (!disposed && event.latLng) options.click(event.latLng.toJSON()) }))
  function clearMarker(id: string) { const entry = markers.get(id); if (entry) { entry.listener.remove(); entry.marker.map = null; markers.delete(id) } }
  function reveal(position: MapPosition, padding: MapPadding) {
    if (disposed || !validPosition(position)) return
    const safe = boundedPadding(padding, options.element.clientWidth, options.element.clientHeight)
    map.fitBounds({ north: position.lat, south: position.lat, east: position.lng, west: position.lng }, safe)
  }
  return {
    markers(values: readonly MapMarker[], selectedId: string | null) {
      if (disposed) return
      const ids = new Set(values.filter(value => validPosition(value.position)).map(value => value.id))
      for (const id of markers.keys()) if (!ids.has(id)) clearMarker(id)
      for (const value of values) {
        if (!validPosition(value.position)) continue
        let entry = markers.get(value.id)
        if (!entry) {
          const marker = new markerLibrary.AdvancedMarkerElement({ map, position: value.position, title: value.title, gmpClickable: true })
          const listener = marker.addListener('click', () => options.select(value.id))
          entry = { marker, listener, selected: false }
          markers.set(value.id, entry)
        }
        entry.marker.position = value.position
        entry.marker.title = value.title
        const selected = value.id === selectedId
        entry.marker.zIndex = selected ? 10 : 1
        if (entry.selected !== selected) {
          // Scale the pin, not the SDK-positioned marker host and its translation.
          entry.marker.replaceChildren(...(selected ? [new markerLibrary.PinElement({ scale: 1.15 })] : []))
          entry.selected = selected
        }
      }
    },
    reveal,
    async searchPlaces(query) {
      if (disposed || !query.trim()) return { places: [], source: 'google' }
      const load = window.google?.maps?.importLibrary?.bind(window.google.maps) || importLibrary
      const { Place } = await load('places') as google.maps.PlacesLibrary
      if (disposed) throw new Error('Map disposed.')
      const { places } = await Place.searchByText({ textQuery: query.trim(), fields: ['displayName', 'formattedAddress', 'location'], locationBias: map.getBounds() })
      if (disposed) throw new Error('Map disposed.')
      return { source: 'google', places: places.flatMap(place => place.location && place.displayName ? [{ id: place.id, name: place.displayName, address: place.formattedAddress || '', position: place.location.toJSON() }] : []) }
    },
    showPlace(place) {
      if (disposed) return
      if (placeMarker) { placeMarker.map = null; placeMarker = undefined }
      if (place && validPosition(place.position)) {
        placeMarker = new markerLibrary.AdvancedMarkerElement({ map, position: place.position, title: place.name, zIndex: 11 })
        map.panTo(place.position)
      }
    },
    zoom(value) { if (!disposed && Number.isFinite(value) && map.getZoom() !== value) map.setZoom(Math.max(1, Math.min(20, value))) },
    recenter() { if (!disposed) { map.setCenter(initialCenter); map.setZoom(initialZoom) } },
    mapType(value) { if (!disposed) map.setMapTypeId(value) },
    resize() { if (!disposed) google.maps.event.trigger(map, 'resize') },
    dispose() {
      if (disposed) return
      disposed = true
      failures.delete(failure)
      if (placeMarker) placeMarker.map = null
      const zoomIndex = zoomControls.getArray().indexOf(zoomIndicator)
      if (zoomIndex >= 0) zoomControls.removeAt(zoomIndex)
      for (const listener of listeners) listener.remove()
      for (const id of [...markers.keys()]) clearMarker(id)
      google.maps.event.clearInstanceListeners(map)
      options.element.replaceChildren()
    },
  }
}
