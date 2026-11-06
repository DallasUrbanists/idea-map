<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import MapShell from '../app/components/MapShell.vue'
import MapCanvas from '../app/components/MapCanvas.vue'
import MapSearchBar from '../app/components/MapSearchBar.vue'
import MapActionBar from '../app/components/MapActionBar.vue'
import AnimatedIcon from '../app/components/AnimatedIcon.vue'
import type { IconName } from '../app/components/icon-assets'
import NavigationRail from '../app/components/NavigationRail.vue'
import Tray from '../app/components/Tray.vue'
import Button from '../app/components/Button.vue'
import Input from '../app/components/Input.vue'
import Dialog from '../app/components/Dialog.vue'
import Toast from '../app/components/Toast.vue'
import { isMapView, useMapNavigation, type MapView, type MapViewEntry } from '../app/composables/useMapNavigation'
import type { MapPosition, MapPadding, MapPlace, MapPlaceResults } from '../app/composables/map-adapter'
import type { MapPresentation } from '../app/composables/map-layout'

const props = withDefaults(defineProps<{ presentation?: MapPresentation; initialView?: MapView; apiKey?: string; mapId?: string; actionItems?: readonly { value: string; label: string }[] }>(), { presentation: 'auto', initialView: 'map', apiKey: import.meta.env.STORYBOOK_GOOGLE_MAPS_API_KEY || '', mapId: import.meta.env.STORYBOOK_GOOGLE_MAPS_MAP_ID || '', actionItems: () => [{ value: 'results', label: 'Browse ideas' }] })
const ideas = [
  { id: 'crossing', title: 'A safer library crossing', location: 'Downtown Dallas', description: 'A shorter crossing and a protected waiting area would make the trip to the library more comfortable.', position: { lat: 32.7769, lng: -96.7973 } },
  { id: 'shade', title: 'Shade at the bus stop', location: 'Main Street', description: 'Add shade and an accessible seat so neighbors can comfortably wait for the bus.', position: { lat: 32.782, lng: -96.795 } },
  { id: 'park', title: 'A greener neighborhood corner', location: 'Arts District', description: 'Replace unused paving with trees and a small public space for the neighborhood.', position: { lat: 32.787, lng: -96.801 } },
]
const destinations = [{ value: 'map', label: 'Explore' }, { value: 'search', label: 'Search' }, { value: 'new-idea', label: 'New idea' }, { value: 'saved', label: 'Saved ideas' }, { value: 'profile', label: 'Profile' }, { value: 'settings', label: 'Settings' }]
const railItems = destinations.map(item => ({ ...item, href: `#${item.value}` }))
const navIcons: Record<string, IconName> = { map: 'explore', search: 'search', saved: 'saved', profile: 'avatar', settings: 'settings' }
const nav = useMapNavigation()
const { current, query, draft, selectedIdeaId, sheetMaximized, camera, canGoBack } = nav
const remembered = ref<MapViewEntry>({ view: 'results' })
const visibleView = computed(() => current.value.view === 'map' ? remembered.value : current.value)
const foregroundOpen = computed(() => current.value.view !== 'map')
const titles: Record<MapView, string> = { map: 'Explore', search: 'Search history', results: 'Community ideas', idea: 'Idea details', 'new-idea': 'New idea', saved: 'Saved ideas', profile: 'Profile', settings: 'Settings', menu: 'App menu' }
const title = computed(() => visibleView.value.view === 'idea' ? ideas.find(idea => idea.id === visibleView.value.ideaId)?.title || 'Idea unavailable' : titles[visibleView.value.view])
const selected = computed(() => ideas.find(idea => idea.id === visibleView.value.ideaId))
const matches = computed(() => ideas.filter(idea => `${idea.title} ${idea.location}`.toLowerCase().includes((visibleView.value.query ?? query.value).toLowerCase())))
const saved = ref<string[]>(['shade'])
const markers = computed(() => [...ideas.map(idea => ({ id: idea.id, title: idea.title, position: idea.position })), ...(draft.position ? [{ id: 'draft', title: 'New idea location', position: draft.position }] : [])])
const map = ref<InstanceType<typeof MapCanvas>>()
const tray = ref<InstanceType<typeof Tray>>()
const shell = ref<InstanceType<typeof MapShell>>()
const heading = ref<HTMLElement>()
const notice = ref(false)
const noticeText = ref('')
const mapType = ref<'roadmap' | 'satellite'>('roadmap')
const insets = ref<MapPadding>({ top: 0, right: 0, bottom: 0, left: 0 })
const readyCount = ref(0)
const placeResults = ref<MapPlaceResults>({ places: [], source: 'google' })
const placeStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
let placeRequest = 0
const searchRevision = ref(0)
function clearPlace() { map.value?.showPlace(null) }
function cancelSearch() { placeRequest++; placeResults.value = { places: [], source: 'google' }; placeStatus.value = 'idle' }
watch(query, () => { clearPlace(); cancelSearch() }, { flush: 'sync' })
watch(() => [current.value.view, current.value.query, searchRevision.value] as const, async ([view, text]) => {
  cancelSearch()
  const term = text?.trim()
  if (view !== 'results' || !term) return
  const request = placeRequest
  placeStatus.value = 'loading'
  try {
    const result = await map.value?.searchPlaces(term)
    if (request !== placeRequest) return
    if (!result) throw new Error('Map unavailable.')
    placeResults.value = result
    placeStatus.value = 'ready'
  } catch { if (request === placeRequest) placeStatus.value = 'error' }
}, { immediate: true })
onBeforeUnmount(() => { placeRequest++ })
if (props.initialView !== 'map') { nav.visit(props.initialView, props.initialView === 'idea' ? 'crossing' : undefined); remembered.value = { ...current.value } }
function captureScroll() { nav.setScroll(current.value.view, tray.value?.contentElement?.scrollTop || 0, current.value.ideaId, current.value.query) }
async function restoreView() {
  remembered.value = { ...current.value }
  await nextTick()
  if (tray.value?.contentElement) tray.value.contentElement.scrollTop = nav.getScroll(current.value.view, current.value.ideaId)
  heading.value?.focus({ preventScroll: true })
}
async function visit(value: string) {
  if (!isMapView(value)) return
  clearPlace()
  if (value === 'map') { close(); return }
  captureScroll(); nav.visit(value); await restoreView()
}
function search() { searchRevision.value++; void visit('results') }
async function openPlace(place: MapPlace) {
  captureScroll()
  remembered.value = { ...current.value }
  nav.close()
  await nextTick()
  map.value?.showPlace(place)
  shell.value?.$el.querySelector('[aria-label="Open profile and app menu"]')?.focus({ preventScroll: true })
}
async function openIdea(id: string) {
  clearPlace()
  if (id === 'draft') { await visit('new-idea'); return }
  const idea = ideas.find(item => item.id === id)
  if (!idea) return
  captureScroll(); nav.openIdea(id); await restoreView()
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  if (current.value.view === 'idea' && current.value.ideaId === id) map.value?.reveal(idea.position)
}
async function close() {
  clearPlace()
  captureScroll(); if (current.value.view !== 'map') remembered.value = { ...current.value }; nav.close()
  await nextTick()
  shell.value?.$el.querySelector('[aria-label="Open profile and app menu"]')?.focus({ preventScroll: true })
}
async function back() { clearPlace(); captureScroll(); nav.back(); if (current.value.view === 'map') { await nextTick(); shell.value?.$el.querySelector('[aria-label="Open profile and app menu"]')?.focus({ preventScroll: true }) } else await restoreView() }
function trayOpen(value: boolean) { if (!value) void close(); else { clearPlace(); if (remembered.value.query !== undefined) query.value = remembered.value.query; nav.visit(remembered.value.view, remembered.value.ideaId); void restoreView() } }
function railClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a')
  if (link) { event.preventDefault(); void visit(link.getAttribute('href')?.slice(1) || 'map') }
}
function escaped(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || !foregroundOpen.value || document.querySelector('[role="menu"][data-state="open"], [role="dialog"]')) return
  event.preventDefault(); void back()
}
function toast(text: string) { noticeText.value = text; notice.value = true }
function saveIdea() {
  if (!selected.value) return
  const id = selected.value.id
  if (saved.value.includes(id)) { saved.value = saved.value.filter(value => value !== id); toast('Removed from this demo’s saved ideas.') }
  else { saved.value.push(id); toast('Saved for this demo session.') }
}
function setType(type: 'roadmap' | 'satellite') { mapType.value = type; map.value?.setMapType(type) }
function location(position: MapPosition) { if (current.value.view === 'new-idea') draft.position = position }
function scroll(event: Event) { nav.setScroll(current.value.view, (event.target as HTMLElement).scrollTop, current.value.ideaId, current.value.query) }
</script>

<template>
  <MapShell ref="shell" :presentation="presentation" :foreground-open="foregroundOpen" controls-position="top" @occlusion="insets = $event" @keydown="escaped">
    <template #map>
      <MapCanvas ref="map" :api-key="apiKey" :map-id="mapId" :markers="markers" :selected-id="selectedIdeaId" :zoom="camera.zoom" :occlusion="insets"
        @select="openIdea" @camera-change="camera = $event" @map-click="location" @ready="readyCount++; map?.setMapType(mapType)" />
      <span class="map-instance-status" :data-map-ready-count="readyCount" aria-hidden="true"></span>
    </template>
    <template #navigation>
      <NavigationRail :current="current.view === 'idea' ? 'map' : current.view" :items="railItems" @click="railClick">
        <template #icon="{ item }"><AnimatedIcon v-if="navIcons[item.value]" :name="navIcons[item.value]" /><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg></template>
      </NavigationRail>
    </template>
    <template #search>
      <MapSearchBar v-model="query" :foreground-open="foregroundOpen" :can-go-back="canGoBack" :history-open="current.view === 'search'" panel-id="map-view-content" :destinations="destinations"
        @back="back" @history="visit('search')" @close="close" @navigate="visit" @search="search" />
    </template>
    <template #foreground="{ placement, maxHeight, onGeometry }">
      <Tray ref="tray" :open="foregroundOpen" v-model:maximize="sheetMaximized" :placement="placement" :label="title" :max-height="maxHeight" :show-close="false" @update:open="trayOpen" @geometry="onGeometry" @scroll="scroll">
        <template #head><h1 ref="heading" tabindex="-1">{{ title }}</h1></template>
        <div id="map-view-content" class="map-view-content">
          <template v-if="visibleView.view === 'search'">
            <p class="demo-context">Synthetic search history</p>
            <Button v-for="term in ['shade', 'library', 'park']" :key="term" variant="transparent" @click="query = term; visit('results')">{{ term }}</Button>
            <p>Search ideas by title or neighborhood. Place searches are sent to Google Maps.</p>
          </template>
          <template v-else-if="visibleView.view === 'results' || visibleView.view === 'saved'">
            <p class="demo-context">{{ visibleView.view === 'saved' ? 'Saved in this demo session' : 'Synthetic community ideas' }}</p>
            <h2 v-if="visibleView.view === 'results' && matches.length">Ideas</h2>
            <ul class="idea-results">
              <li v-for="idea in (visibleView.view === 'saved' ? ideas.filter(item => saved.includes(item.id)) : matches)" :key="idea.id">
                <button type="button" class="idea-result" @click="openIdea(idea.id)"><span class="idea-thumbnail" aria-hidden="true"><AnimatedIcon name="location" /></span><span><strong>{{ idea.title }}</strong><small>{{ idea.location }}</small><span>{{ idea.description }}</span></span></button>
              </li>
            </ul>
            <template v-if="visibleView.view === 'results' && visibleView.query?.trim()">
              <p class="demo-context">Place searches are sent to Google Maps.</p>
              <p v-if="placeStatus === 'loading'" role="status">Searching places…</p>
              <p v-else-if="placeStatus === 'error'" role="status">Places are unavailable. Check the Maps configuration or connection and search again.</p>
              <section v-else-if="placeResults.places.length" class="place-results" aria-label="Place results">
                <h2>Places</h2>
                <ul class="idea-results">
                  <li v-for="place in placeResults.places" :key="place.id"><button type="button" class="place-result" @click="openPlace(place)"><span class="idea-thumbnail" aria-hidden="true"><AnimatedIcon name="location" /></span><span><strong>{{ place.name }}</strong><small>{{ place.address }}</small></span></button></li>
                </ul>
                <p v-if="placeResults.source === 'google'" class="place-attribution" translate="no">Google Maps</p>
                <p v-else class="demo-context">Synthetic place fixture</p>
              </section>
              <p v-else-if="placeStatus === 'ready' && !matches.length" role="status">No matching ideas or places. Try another search.</p>
            </template>
            <p v-if="visibleView.view === 'saved' && !saved.length" role="status">No saved ideas yet. Open an idea and choose Save.</p>
          </template>
          <template v-else-if="visibleView.view === 'idea' && selected">
            <div class="idea-illustration" role="img" aria-label="Illustrated neighborhood crossing"><svg viewBox="0 0 360 140" aria-hidden="true"><rect width="360" height="140" fill="var(--map-park)" /><path d="M-10 90h400M180-10v180" stroke="var(--map-road)" stroke-width="42" /><path d="M200 68h36m-36 10h36m-36 10h36m-36 10h36m-36 10h36" stroke="var(--map-road-label)" stroke-width="5" /><circle cx="78" cy="35" r="22" fill="var(--color-success)" /><circle cx="290" cy="110" r="20" fill="var(--color-success)" /></svg></div>
            <p class="demo-context">{{ selected.location }} · Synthetic idea</p>
            <div class="idea-actions"><Button variant="secondary" @click="saveIdea">{{ saved.includes(selected.id) ? 'Unsave idea' : 'Save idea' }}</Button><Button variant="transparent" @click="map?.reveal(selected.position)">Show on map</Button></div>
            <h2>About this idea</h2><p>{{ selected.description }}</p>
            <p>Explore the location on the map while keeping these details open. Use Back to return to your results, or Close to return directly to the map.</p>
            <h2>Community context</h2><p v-for="index in 5" :key="index">This example uses invented content to demonstrate independent scrolling, readable details, and a persistent map. No live submission or account data is loaded.</p>
          </template>
          <form v-else-if="visibleView.view === 'new-idea'" class="draft-form" @submit.prevent="toast('Demo draft retained in memory; nothing was submitted.')">
            <p class="demo-context">In-memory draft · no submission</p>
            <Input v-model="draft.title" label="Idea title" required />
            <Input v-model="draft.description" label="Idea description" multiline />
            <p>Click the exposed map to choose a location, or use its current center.</p>
            <Button variant="secondary" @click="draft.position = { ...camera.center }">Use map center</Button>
            <p role="status">{{ draft.position ? `Location: ${draft.position.lat.toFixed(4)}, ${draft.position.lng.toFixed(4)}` : 'No location selected' }}</p>
            <Button type="submit">Keep demo draft</Button>
          </form>
          <template v-else-if="visibleView.view === 'profile'">
            <p class="demo-context">Synthetic profile</p><h2>Your neighborhood, your ideas</h2><p>Profile and settings sit above the same map. No account request is made.</p><Button variant="secondary" @click="visit('settings')">Open settings</Button>
          </template>
          <template v-else-if="visibleView.view === 'settings'">
            <p class="demo-context">Map settings</p><fieldset><legend>Basemap</legend><div class="idea-actions"><Button variant="secondary" :aria-pressed="mapType === 'roadmap'" @click="setType('roadmap')">Streets</Button><Button variant="secondary" :aria-pressed="mapType === 'satellite'" @click="setType('satellite')">Satellite</Button></div></fieldset>
            <p>Map type changes without replacing the map. The Storybook theme control changes the interface; provider basemap styling is configured separately.</p>
            <Dialog title="Clear demo draft?" description="This confirmation temporarily blocks map interaction; the map remains mounted.">
              <template #trigger><Button variant="secondary">Review clear draft</Button></template><p>The example does not discard your draft. Close this dialog to return to the same map and settings pane.</p>
            </Dialog>
          </template>
          <template v-else><Button v-for="item in destinations" :key="item.value" variant="transparent" @click="visit(item.value)">{{ item.label }}</Button></template>
        </div>
      </Tray>
    </template>
    <template #controls="{ compact }">
      <MapActionBar :items="actionItems" :visible="!compact || !sheetMaximized || !foregroundOpen" @select="visit" />
    </template>
    <template #feedback><Toast v-model:open="notice" :title="noticeText" :duration="5000" /></template>
  </MapShell>
</template>

<style scoped>
.map-view-content { padding: var(--gap-standard) var(--gap-spread) var(--gap-spread); }
.map-view-content h2 { font: var(--weight-bold) var(--font-heading) / var(--line-heading) var(--font-family-heading); margin-top: var(--gap-spread); }
.map-view-content h1:focus, h1:focus { outline: none; }
.demo-context { color: var(--color-text-muted); font-size: var(--font-small); }
.idea-results { list-style: none; padding: 0; margin: 0; }
.idea-results li + li { border-top: 1px solid var(--color-border-soft); }
.place-results { margin-top: var(--gap-spread); border-top: 1px solid var(--color-border-soft); }
.place-attribution { display: inline-block; margin: var(--gap-compact) 0; padding: var(--gap-tight) var(--gap-compact); background: #fff; color: #1f1f1f; font: 400 12px/1.4 Roboto, Arial, sans-serif; white-space: nowrap; }
.idea-result, .place-result { display: flex; align-items: flex-start; gap: var(--gap-standard); box-sizing: border-box; width: 100%; min-height: var(--size-minimum-tap-target); padding: var(--gap-standard) 0; background: transparent; border: 0; text-align: start; color: inherit; font: inherit; cursor: pointer; }
.idea-result > span:last-child, .place-result > span:last-child { display: grid; gap: var(--gap-tight); min-width: 0; }
.idea-result small, .place-result small { color: var(--color-text-muted); }
.idea-result:focus-visible, .place-result:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
.idea-thumbnail { display: grid; place-items: center; flex: 0 0 var(--size-floating-control); height: var(--size-floating-control); border-radius: var(--radius-card); background: var(--map-park); color: var(--color-accent); font-size: var(--font-title); }
.idea-illustration { margin: calc(-1 * var(--gap-standard)) calc(-1 * var(--gap-spread)) 0; }
.idea-illustration svg { width: 100%; display: block; }
.idea-actions { display: flex; flex-wrap: wrap; gap: var(--gap-compact); }
.draft-form { display: grid; gap: var(--gap-standard); }
fieldset { min-width: 0; border: 1px solid var(--color-border-soft); border-radius: var(--radius-control); padding: var(--gap-standard); }
</style>

<style>
.fixture-map { overflow: hidden; background-color: var(--map-ground); background-image: linear-gradient(90deg, transparent 46%, var(--map-road) 46%, var(--map-road) 54%, transparent 54%), linear-gradient(transparent 46%, var(--map-road) 46%, var(--map-road) 54%, transparent 54%); background-size: 180px 140px; touch-action: none; }
.fixture-map:focus-visible { outline: 3px solid var(--color-focus); outline-offset: -3px; }
.fixture-map-label { position: absolute; left: calc(var(--map-attribution-inset, 0px) + var(--gap-compact)); bottom: var(--gap-compact); padding: var(--gap-tight); background: var(--chrome); color: var(--color-text); z-index: 2; }
.fixture-zoom-indicator { position: absolute; right: 0; bottom: 0; padding: 0 6px; color: #000; background: rgba(245,245,245,.7); font: 10px/14px Roboto, Arial, sans-serif; }
.fixture-temporary-marker { position: absolute; left: 50%; top: 50%; }
.fixture-markers button { position: absolute; min-height: 44px; max-width: 140px; padding: var(--gap-compact); border: 2px solid var(--color-accent); border-radius: var(--radius-pill); color: var(--color-text); background: var(--chrome); font: var(--weight-medium) var(--font-small) / var(--line-body) var(--font-family-body); cursor: pointer; }
.fixture-markers button[aria-pressed="true"] { background: var(--color-selection); }
.fixture-markers button:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
</style>
