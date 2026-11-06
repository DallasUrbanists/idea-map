import test from 'node:test'
import assert from 'node:assert/strict'
import { useMapNavigation } from '../apps/web/app/composables/useMapNavigation.ts'

test('Back restores previous context while Close returns directly to map', () => {
  const nav = useMapNavigation()
  nav.visit('results'); nav.openIdea('crossing'); nav.visit('profile'); nav.visit('settings')
  nav.back(); assert.equal(nav.current.value.view, 'profile')
  nav.back(); assert.deepEqual(nav.current.value, { view: 'idea', ideaId: 'crossing', query: '' })
  nav.close(); assert.deepEqual(nav.history.value, [{ view: 'map' }]); assert.equal(nav.canGoBack.value, false)
  nav.back(); assert.equal(nav.current.value.view, 'map')
})
test('draft, camera, query, list scroll and sheet position survive every foreground view', () => {
  const nav = useMapNavigation()
  nav.draft.title = 'Shade'; nav.draft.position = { lat: 32.7, lng: -96.8 }
  nav.query.value = 'library'; nav.camera.value = { center: { lat: 33, lng: -97 }, zoom: 15 }; nav.sheetMaximized.value = true
  nav.setScroll('results', 230)
  for (const view of ['search', 'results', 'new-idea', 'saved', 'profile', 'settings']) nav.visit(view)
  nav.close(); nav.visit('new-idea')
  assert.equal(nav.draft.title, 'Shade'); assert.deepEqual(nav.draft.position, { lat: 32.7, lng: -96.8 })
  assert.equal(nav.query.value, 'library'); assert.equal(nav.getScroll('results'), 230)
  assert.equal(nav.camera.value.zoom, 15); assert.equal(nav.sheetMaximized.value, true)
})
test('consecutive duplicate views do not grow history and idea selection does not move the camera', () => {
  const nav = useMapNavigation(); const camera = structuredClone({ ...nav.camera.value, center: { ...nav.camera.value.center } })
  nav.openIdea('a'); nav.openIdea('a'); assert.equal(nav.history.value.length, 2)
  nav.openIdea('b'); assert.equal(nav.history.value.length, 3); assert.equal(nav.selectedIdeaId.value, 'b')
  nav.back(); assert.equal(nav.selectedIdeaId.value, 'a'); assert.deepEqual(nav.camera.value, camera)
})
test('Back restores distinct committed queries and each results list scroll context', () => {
  const nav = useMapNavigation()
  nav.query.value = 'shade'; nav.visit('results'); nav.setScroll('results', 80)
  nav.openIdea('shade')
  nav.query.value = 'library'; nav.visit('results'); nav.setScroll('results', 160)
  nav.back(); assert.equal(nav.query.value, 'shade'); assert.equal(nav.current.value.view, 'idea')
  nav.back(); assert.equal(nav.current.value.view, 'results'); assert.equal(nav.query.value, 'shade'); assert.equal(nav.getScroll('results'), 80)
  nav.query.value = 'library'; assert.equal(nav.getScroll('results'), 160)
})
test('invalid entries and scroll values do not corrupt state', () => {
  const nav = useMapNavigation()
  assert.throws(() => nav.visit('unknown'), TypeError); assert.throws(() => nav.openIdea(''), TypeError)
  nav.setScroll('results', -4); assert.equal(nav.getScroll('results'), 0)
  nav.setScroll('results', NaN); assert.equal(nav.getScroll('results'), 0)
  nav.setScroll('idea', 40, 'a'); nav.setScroll('idea', 80, 'b')
  assert.equal(nav.getScroll('idea', 'a'), 40); assert.equal(nav.getScroll('idea', 'b'), 80)
})
