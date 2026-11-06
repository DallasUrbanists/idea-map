import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedPadding, validPosition } from '../apps/web/app/composables/map-adapter.ts'
import { createGoogleMapAdapter } from '../apps/web/app/composables/google-map-adapter.ts'

test('location and reveal padding validation retain an exposed interaction area', () => {
  assert.equal(validPosition({ lat: 91, lng: 0 }), false)
  assert.equal(validPosition({ lat: 32.7, lng: -96.8 }), true)
  const padding = boundedPadding({ top: 500, bottom: 500, left: NaN, right: -1 }, 320, 400)
  assert.equal(padding.left, 0); assert.equal(padding.right, 0)
  assert.equal(padding.top + padding.bottom, 356)
})

test('real adapter boundary creates one map, updates markers/camera without reconstruction, and disposes listeners', async () => {
  const originalWindow = globalThis.window; const originalGoogle = globalThis.google; const originalDocument = globalThis.document
  const maps = []; const markerInstances = []; let imports = 0; let removed = 0; let errors = 0; let searchRequest
  class FakeControls {
    constructor() { this.items = [] }
    push(value) { this.items.push(value) }
    getArray() { return this.items }
    removeAt(index) { this.items.splice(index, 1) }
  }
  class FakeMap {
    constructor(element, options) { this.options = options; this.center = options.center; this.level = options.zoom; this.events = new Map(); this.controls = [new FakeControls()]; maps.push(this) }
    addListener(name, callback) { this.events.set(name, callback); return { remove: () => { removed++; this.events.delete(name) } } }
    getCenter() { return { toJSON: () => this.center } }
    getZoom() { return this.level }
    setZoom(value) { this.level = value; this.events.get('zoom_changed')?.() }
    setCenter(value) { this.center = value }
    panTo(value) { this.center = value; this.pan = value }
    fitBounds(bounds, padding) { this.bounds = bounds; this.padding = padding; this.setZoom(20) }
    getBounds() { return 'synthetic-bounds' }
    setMapTypeId(value) { this.type = value }
  }
  class FakeMarker {
    constructor(options) { Object.assign(this, options); this.style = {}; this.children = []; this.replacements = 0; markerInstances.push(this) }
    replaceChildren(...children) { this.children = children; this.replacements++ }
    addListener(name, callback) { this.click = callback; return { remove: () => { removed++ } } }
  }
  class FakePin { constructor(options) { this.options = options } }
  class FakePlace { static async searchByText(request) { searchRequest = request; return { places: [{ id: 'place', displayName: 'Synthetic place', formattedAddress: 'Synthetic address', location: { toJSON: () => ({ lat: 32.8, lng: -96.7 }) } }] } } }
  const google = { maps: {
    importLibrary: async name => { imports++; return name === 'maps' ? { Map: FakeMap } : name === 'marker' ? { AdvancedMarkerElement: FakeMarker, PinElement: FakePin } : { Place: FakePlace } },
    ControlPosition: { BOTTOM_RIGHT: 0 },
    event: { trigger() {}, clearInstanceListeners() {} },
  } }
  globalThis.google = google; globalThis.window = { google }
  globalThis.document = { createElement: () => ({ style: {}, setAttribute() {} }) }
  const selected = []; const cameras = []; let cleared = 0
  const options = { apiKey: 'synthetic-fixture-key', element: { clientWidth: 1000, clientHeight: 600, replaceChildren() { cleared++ } }, center: { lat: 32, lng: -96 }, zoom: 13, select: id => selected.push(id), camera: value => cameras.push(value), click() {}, error: () => { errors++ } }
  try {
    const adapter = await createGoogleMapAdapter(options)
    const marker = { id: 'idea', title: 'Synthetic idea', position: { lat: 32.7, lng: -96.8 } }
    adapter.markers([marker], marker.id)
    assert.equal(markerInstances[0].style.scale, undefined)
    assert.equal(markerInstances[0].children[0].options.scale, 1.15)
    assert.equal(markerInstances[0].zIndex, 10)
    adapter.markers([marker], marker.id)
    assert.equal(markerInstances[0].replacements, 1)
    adapter.markers([{ ...marker, title: 'Updated idea' }], null)
    assert.deepEqual(markerInstances[0].children, [])
    assert.equal(markerInstances[0].style.scale, undefined)
    assert.equal(markerInstances[0].zIndex, 1)
    assert.equal(markerInstances[0].position, marker.position)
    assert.equal(maps.length, 1); assert.equal(imports, 2); assert.equal(markerInstances.length, 1)
    assert.equal(maps[0].options.mapId, 'DEMO_MAP_ID')
    assert.equal(maps[0].options.cameraControl, true)
    assert.equal(maps[0].options.zoomControl, false)
    markerInstances[0].click(); assert.deepEqual(selected, ['idea'])
    adapter.zoom(15); maps[0].events.get('idle')(); assert.equal(cameras.at(-1).zoom, 15)
    adapter.reveal(marker.position, { left: 200, right: 0, top: 0, bottom: 0 })
    assert.deepEqual(maps[0].bounds, { north: 32.7, south: 32.7, east: -96.8, west: -96.8 })
    assert.equal(maps[0].padding.left, 200)
    assert.equal(maps[0].controls[0].items[0].textContent, 'Zoom 20')
    const result = await adapter.searchPlaces(' library ')
    assert.equal(searchRequest.textQuery, 'library'); assert.equal(searchRequest.locationBias, 'synthetic-bounds')
    assert.equal(result.places[0].name, 'Synthetic place'); assert.equal(result.source, 'google')
    adapter.showPlace(result.places[0]); assert.equal(maps[0].level, 20); assert.deepEqual(maps[0].pan, result.places[0].position)
    assert.equal(markerInstances[1].map, maps[0]); adapter.showPlace(null); assert.equal(markerInstances[1].map, null)
    adapter.mapType('satellite'); assert.equal(maps[0].type, 'satellite')
    adapter.markers([], null); assert.equal(markerInstances[0].map, null)
    window.gm_authFailure(); assert.equal(errors, 1)
    adapter.dispose(); adapter.dispose(); assert.equal(cleared, 1); assert.equal(removed, 4); assert.equal(maps[0].controls[0].items.length, 0)
    window.gm_authFailure(); assert.equal(errors, 1)
    const abort = new AbortController(); abort.abort()
    await assert.rejects(() => createGoogleMapAdapter({ ...options, signal: abort.signal }), /cancelled/)
    assert.equal(maps.length, 1); assert.equal(imports, 3)
    await assert.rejects(() => createGoogleMapAdapter({ ...options, apiKey: '' }), /development Maps key/)
    await assert.rejects(() => createGoogleMapAdapter({ ...options, apiKey: 'different-fixture-key' }), /configuration changed/)
  } finally { globalThis.window = originalWindow; globalThis.google = originalGoogle; globalThis.document = originalDocument }
})
