import { provide } from 'vue'
import { MAP_ADAPTER_FACTORY } from '../app/composables/map-adapter'

export const withMapFixture = (story) => ({
  components: { story },
  template: '<story />',
  setup() {
    let constructions = 0
    provide(MAP_ADAPTER_FACTORY, async options => {
      const root = options.element
      constructions++
      root.dataset.fixtureConstructions = String(constructions)
      root.dataset.fixtureReveals = '0'
      root.setAttribute('aria-label', 'Synthetic map adapter fixture, not a live basemap')
      root.tabIndex = 0
      root.classList.add('fixture-map')
      const notice = document.createElement('small')
      notice.className = 'fixture-map-label'
      notice.textContent = 'Synthetic SDK fixture · no live map requests'
      const markers = document.createElement('div')
      markers.className = 'fixture-markers'
      const zoomIndicator = document.createElement('span')
      zoomIndicator.className = 'zoom-indicator fixture-zoom-indicator'
      zoomIndicator.setAttribute('aria-hidden', 'true')
      const temporary = document.createElement('div')
      temporary.className = 'fixture-temporary-marker'
      root.replaceChildren(notice, markers, temporary, zoomIndicator)
      let camera = { center: { ...options.center }, zoom: options.zoom }
      let pointer
      const update = () => { root.dataset.fixtureCamera = JSON.stringify(camera); zoomIndicator.textContent = `Zoom ${camera.zoom}`; options.camera(structuredClone(camera)) }
      const down = event => { if (!event.target.closest('button')) { pointer = { x: event.clientX, y: event.clientY }; root.setPointerCapture(event.pointerId) } }
      const move = event => { if (pointer) { camera.center.lng += (pointer.x - event.clientX) * 0.0001; camera.center.lat += (event.clientY - pointer.y) * 0.0001; pointer = { x: event.clientX, y: event.clientY }; update() } }
      const up = () => { pointer = undefined }
      const click = event => { if (!event.target.closest('button')) options.click({ lat: camera.center.lat + 0.001, lng: camera.center.lng + 0.001 }) }
      const wheel = event => { event.preventDefault(); camera.zoom = Math.max(1, Math.min(20, camera.zoom + (event.deltaY > 0 ? -1 : 1))); update() }
      const key = event => {
        if (event.target !== root) return
        if (event.key === 'ArrowLeft') camera.center.lng -= 0.01
        else if (event.key === 'ArrowRight') camera.center.lng += 0.01
        else if (event.key === 'ArrowUp') camera.center.lat += 0.01
        else if (event.key === 'ArrowDown') camera.center.lat -= 0.01
        else return
        event.preventDefault(); update()
      }
      const handlers = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['click', click], ['wheel', wheel], ['keydown', key]]
      for (const [name, handler] of handlers) root.addEventListener(name, handler, { passive: false })
      update()
      return {
        markers(values, selected) {
          markers.replaceChildren(...values.map((value, index) => {
            const button = document.createElement('button')
            button.type = 'button'; button.textContent = value.title
            button.setAttribute('aria-pressed', String(value.id === selected))
            button.style.left = `${20 + index * 22}%`; button.style.top = `${35 + index * 12}%`
            button.addEventListener('click', () => options.select(value.id))
            return button
          }))
        },
        reveal(position, padding) { camera.center = { ...position }; camera.zoom = 20; root.dataset.fixtureRevealPadding = JSON.stringify(padding); root.dataset.fixtureReveals = String(Number(root.dataset.fixtureReveals) + 1); update() },
        async searchPlaces(query) {
          root.dataset.fixtureSearch = query
          if (query === 'slow') await new Promise(resolve => setTimeout(resolve, 300))
          if (query === 'failure' || root.dataset.fixtureFailSearch === 'true') throw new Error('Synthetic Places failure')
          const places = [{ id: 'shade-place', name: 'Shade Plaza', address: 'Synthetic location', position: { lat: 32.78, lng: -96.79 } }, { id: 'library-place', name: 'Library Park', address: 'Synthetic location', position: { lat: 32.77, lng: -96.8 } }, { id: 'slow-place', name: 'Slow Place', address: 'Synthetic location', position: { lat: 32.77, lng: -96.8 } }]
          return { source: 'fixture', places: places.filter(place => place.name.toLowerCase().includes(query.toLowerCase())) }
        },
        showPlace(place) {
          temporary.textContent = place ? '📍' : ''
          root.dataset.fixturePlace = place?.id || ''
          if (place) { camera.center = { ...place.position }; update() }
        },
        zoom(zoom) { if (camera.zoom !== zoom) { camera.zoom = zoom; update() } },
        recenter() { camera = { center: { ...options.center }, zoom: options.zoom }; update() },
        mapType(value) { root.dataset.fixtureMapType = value },
        resize() {},
        dispose() { for (const [name, handler] of handlers) root.removeEventListener(name, handler); root.replaceChildren(); root.dataset.fixtureDisposed = 'true' },
      }
    })
    return {}
  },
})
export const withProviderFailure = story => ({ components: { story }, template: '<story />', setup() { provide(MAP_ADAPTER_FACTORY, async () => { throw new Error('Injected provider failure') }); return {} } })
