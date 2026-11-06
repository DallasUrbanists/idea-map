<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from './Button.vue'
import { createGoogleMapAdapter } from '../composables/google-map-adapter'
import { MAP_ADAPTER_FACTORY, validPosition, type MapAdapter, type MapCamera, type MapMarker, type MapPadding, type MapPlace, type MapPosition } from '../composables/map-adapter'

const props = withDefaults(defineProps<{ apiKey?: string; mapId?: string; markers?: readonly MapMarker[]; selectedId?: string | null; center?: MapPosition; zoom?: number; occlusion?: MapPadding }>(), { apiKey: '', markers: () => [], selectedId: null, center: () => ({ lat: 32.7767, lng: -96.797 }), zoom: 13, occlusion: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) })
const emit = defineEmits<{ select: [id: string]; 'camera-change': [camera: MapCamera]; 'map-click': [position: MapPosition]; ready: []; error: [] }>()
const suppliedFactory = inject(MAP_ADAPTER_FACTORY, undefined)
const host = ref<HTMLElement>()
const canvas = ref<HTMLElement>()
const status = ref<'loading' | 'ready' | 'error'>('loading')
const missingKey = computed(() => !suppliedFactory && !props.apiKey.trim())
const size = ref({ width: 0, height: 0 })
// Side panes overlay the full-width map; only its attribution moves out from underneath them.
const attributionInset = computed(() => `${Math.max(0, Math.min(props.occlusion.left, Math.max(0, size.value.width - 80)))}px`)
const viewport = computed(() => ({ bottom: `max(0px, calc(${Math.max(0, Math.min(props.occlusion.bottom, Math.max(0, size.value.height - 64)))}px - ${props.occlusion.cornerOverlap ? 'var(--gap-compact)' : '0px'}))` }))
let adapter: MapAdapter | undefined
let attempt = 0
let alive = true
let abort: AbortController | undefined
let observer: ResizeObserver | undefined
let pendingReveal: MapPosition | undefined
function fail() { status.value = 'error'; adapter?.dispose(); adapter = undefined; emit('error') }
async function load() {
  const generation = ++attempt
  abort?.abort()
  adapter?.dispose()
  adapter = undefined
  status.value = 'loading'
  if (missingKey.value || !validPosition(props.center) || !Number.isFinite(props.zoom)) { fail(); return }
  abort = new AbortController()
  let failed = false
  try {
    const instance = await (suppliedFactory || createGoogleMapAdapter)({
      element: canvas.value!, apiKey: props.apiKey, mapId: props.mapId, center: props.center, zoom: props.zoom, signal: abort.signal,
      select: id => { if (alive && generation === attempt) emit('select', id) },
      camera: camera => { if (alive && generation === attempt) emit('camera-change', camera) },
      click: position => { if (alive && generation === attempt) emit('map-click', position) },
      error: () => { if (alive && generation === attempt) { failed = true; fail() } },
    })
    if (!alive || generation !== attempt || failed) { instance.dispose(); return }
    adapter = instance
    adapter.markers(props.markers, props.selectedId)
    status.value = 'ready'
    if (pendingReveal) { reveal(pendingReveal); pendingReveal = undefined }
    emit('ready')
  } catch { if (alive && generation === attempt) fail() }
}
function reveal(position: MapPosition) {
  if (!validPosition(position)) return
  if (!adapter) { pendingReveal = position; return }
  adapter.reveal(position, { ...props.occlusion, bottom: 0 })
}
watch(() => [props.markers, props.selectedId] as const, () => adapter?.markers(props.markers, props.selectedId), { deep: true })
watch(() => props.zoom, value => { if (Number.isFinite(value)) adapter?.zoom(value) })
watch(viewport, async () => { await nextTick(); adapter?.resize() })
onMounted(() => {
  observer = new ResizeObserver(() => { size.value = { width: host.value?.clientWidth || 0, height: host.value?.clientHeight || 0 }; adapter?.resize() })
  if (host.value) observer.observe(host.value)
  if (canvas.value) observer.observe(canvas.value)
  void load()
})
onBeforeUnmount(() => { alive = false; attempt++; abort?.abort(); observer?.disconnect(); adapter?.dispose(); adapter = undefined })
defineExpose({ reveal, searchPlaces: (query: string) => adapter ? adapter.searchPlaces(query) : Promise.reject(new Error('Map unavailable.')), showPlace: (place: MapPlace | null) => adapter?.showPlace(place), recenter: () => adapter?.recenter(), setMapType: (value: 'roadmap' | 'satellite') => adapter?.mapType(value) })
</script>

<template>
  <section ref="host" class="map-canvas" :class="{ 'map-dragging': occlusion.dragging }" aria-label="Interactive idea map" :aria-busy="status === 'loading'" :data-map-status="status">
    <div ref="canvas" class="map-renderer" :style="{ ...viewport, '--map-attribution-inset': attributionInset, '--map-footer-overlap': occlusion.cornerOverlap ? 'var(--gap-compact)' : '0px' }"></div>
    <div v-if="status !== 'ready'" class="map-state" :style="{ ...viewport, left: attributionInset }" role="status">
      <div><h2>{{ status === 'loading' ? 'Loading map' : 'Map unavailable' }}</h2>
        <p v-if="status === 'loading'">Preparing the live basemap.</p>
        <p v-else>{{ missingKey ? 'Configure the non-production Storybook Maps browser key locally to load the live basemap.' : 'The map could not load. Check your connection and development Maps configuration, then retry.' }}</p>
        <Button v-if="status === 'error'" variant="secondary" @click="load">Retry map</Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.map-canvas { position: absolute; inset: 0; background: var(--map-ground); color: var(--color-text); }
.map-renderer, .map-state { position: absolute; inset: 0; transition: bottom var(--motion-sheet) ease-out; }
.map-dragging .map-renderer, .map-dragging .map-state { transition: none; }
@media (prefers-reduced-motion: reduce) { .map-renderer, .map-state { transition: none; } }
/* Preserve Google's native logo/link while keeping it reachable beside a side pane. */
.map-renderer :deep(div:has(> a[href^="https://maps.google.com/maps"])) { margin-left: calc(var(--map-attribution-inset, 0px) + 5px) !important; margin-bottom: var(--map-footer-overlap, 0px) !important; transition: margin-bottom var(--motion-sheet) ease-out; }
.map-renderer :deep(div[style*="inline-flex"][style*="bottom: 0px"]:has(a[href*="google.com/intl/"])),
.map-renderer :deep(.zoom-indicator) { transform: translateY(calc(-1 * (var(--map-footer-overlap, 0px) + var(--map-footer-row-extra, 0px)))); transition: transform var(--motion-sheet) ease-out; }
@media (max-width: 500px) {
  .map-renderer { --map-footer-row-extra: 28px; }
  .map-renderer :deep(gmp-internal-camera-control) { transform: translateY(-28px); }
}
.map-dragging .map-renderer :deep(div:has(> a[href^="https://maps.google.com/maps"])),
.map-dragging .map-renderer :deep(div[style*="inline-flex"][style*="bottom: 0px"]:has(a[href*="google.com/intl/"])),
.map-dragging .map-renderer :deep(.zoom-indicator) { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .map-renderer :deep(div:has(> a[href^="https://maps.google.com/maps"])),
  .map-renderer :deep(div[style*="inline-flex"][style*="bottom: 0px"]:has(a[href*="google.com/intl/"])),
  .map-renderer :deep(.zoom-indicator) { transition: none; }
}
.map-state { display: grid; place-items: center; padding: var(--gap-standard); box-sizing: border-box; overflow: auto; }
.map-state > div { max-width: 24rem; padding: var(--gap-standard); border: 1px solid var(--color-border-soft); border-radius: var(--radius-card); background: var(--chrome); }
.map-state h2 { font: var(--weight-bold) var(--font-heading) / var(--line-heading) var(--font-family-heading); }
.map-state p { overflow-wrap: anywhere; }
</style>
