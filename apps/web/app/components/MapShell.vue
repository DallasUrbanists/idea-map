<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useAdaptivePresentation } from '../composables/useAdaptivePresentation'
import { mapOcclusion, type MapPresentation, type SurfaceBounds } from '../composables/map-layout'
import type { MapPadding } from '../composables/map-adapter'

const props = withDefaults(defineProps<{ presentation?: MapPresentation; foregroundOpen?: boolean; label?: string; controlsPosition?: 'top' | 'bottom' }>(), { presentation: 'auto', foregroundOpen: false, label: 'Map workspace', controlsPosition: 'bottom' })
const emit = defineEmits<{ occlusion: [value: MapPadding]; presentation: [value: 'app' | 'desktop'] }>()
const { layout, visualHeight, visualTop } = useAdaptivePresentation(() => props.presentation)
const root = ref<HTMLElement>()
const search = ref<HTMLElement>()
const rail = ref<HTMLElement>()
const shellBounds = ref<SurfaceBounds>({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
const searchBounds = ref<SurfaceBounds | null>(null)
const trayBounds = ref<SurfaceBounds | null>(null)
const railWidth = ref(0)
const contentId = `map-workspace-${useId()}`
const insets = computed(() => ({
  ...mapOcclusion(shellBounds.value, trayBounds.value, searchBounds.value, railWidth.value, layout.value.placement),
  dragging: Boolean(trayBounds.value?.dragging),
  cornerOverlap: layout.value.placement === 'bottom' && props.foregroundOpen,
}))
const maximum = computed(() => Math.max(100, (visualHeight.value || 650) - 240))
const geometry = (bounds: SurfaceBounds) => { trayBounds.value = bounds }
let observer: ResizeObserver | undefined
let frame = 0
function measure() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (root.value) shellBounds.value = root.value.getBoundingClientRect().toJSON()
    searchBounds.value = search.value?.getBoundingClientRect().toJSON() ?? null
    railWidth.value = rail.value?.getBoundingClientRect().width ?? 0
  })
}
watch([visualHeight, visualTop, () => layout.value.presentation, () => layout.value.placement], async () => { await nextTick(); measure() })
watch(insets, value => emit('occlusion', value), { deep: true })
watch(() => layout.value.presentation, value => emit('presentation', value), { immediate: true })
onMounted(() => {
  observer = new ResizeObserver(measure)
  for (const element of [root.value, search.value]) if (element) observer.observe(element)
  measure()
})
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame) })
</script>

<template>
  <div ref="root" class="map-shell" :data-presentation="layout.presentation" :data-placement="layout.placement" :data-controls-position="controlsPosition"
    :style="{ height: visualHeight ? `${visualHeight}px` : undefined, top: visualTop ? `${visualTop}px` : undefined }">
    <a class="map-skip" :href="`#${contentId}`">Skip to workspace</a>
    <main :id="contentId" :aria-label="label" tabindex="-1" class="map-workspace">
      <div class="map-base"><slot name="map" :occlusion="insets" /></div>
      <div v-show="layout.presentation === 'desktop'" ref="rail" class="map-rail"><slot name="navigation" /></div>
      <div ref="search" class="map-search"><slot name="search" /></div>
      <div class="map-foreground" :data-placement="layout.placement">
        <slot name="foreground" :placement="layout.placement" :max-height="maximum" :on-geometry="geometry" />
      </div>
      <div class="map-floating-controls" :style="{ top: controlsPosition === 'top' ? `${insets.top}px` : undefined, bottom: controlsPosition === 'bottom' ? `max(env(safe-area-inset-bottom, 0px), ${insets.bottom + 44}px)` : undefined, maxHeight: `${Math.max(44, shellBounds.height - insets.bottom - insets.top - 56)}px` }">
        <slot name="controls" :compact="layout.placement === 'bottom'" />
      </div>
      <div class="map-feedback"><slot name="feedback" /></div>
    </main>
  </div>
</template>

<style scoped>
.map-shell { --map-rail-width: 0px; position: relative; isolation: isolate; width: 100%; height: 100dvh; min-height: 0; color: var(--color-text); background: var(--map-ground); font: var(--font-body) / var(--line-body) var(--font-family-body); }
.map-shell[data-presentation="desktop"] { --map-rail-width: var(--size-nav-rail); }
.map-workspace, .map-base { position: absolute; inset: 0; min-width: 0; min-height: 0; }
.map-workspace:focus { outline: none; }
.map-base { z-index: 0; }
.map-rail { position: absolute; z-index: 20; inset: 0 auto 0 0; width: var(--size-nav-rail); background: var(--chrome); }
.map-rail :deep(.nav-rail) { height: 100%; }
.map-search { position: absolute; z-index: 40; top: max(var(--map-inset), env(safe-area-inset-top, 0px)); left: calc(var(--map-rail-width) + max(var(--map-inset), env(safe-area-inset-left, 0px))); right: max(var(--map-inset), env(safe-area-inset-right, 0px)); }
.map-foreground { position: absolute; z-index: 30; inset: 0; pointer-events: none; }
.map-foreground[data-placement="side"] { top: calc(var(--size-floating-control) + 2 * var(--map-inset)); left: var(--map-rail-width); width: min(calc(var(--size-pane-wide) + 2 * var(--map-inset)), calc(100% - var(--map-rail-width) - var(--size-minimum-tap-target))); }
.map-foreground :deep(button), .map-foreground :deep(a), .map-foreground :deep(input) { pointer-events: auto; }
.map-floating-controls { position: absolute; z-index: 20; right: max(var(--map-inset), env(safe-area-inset-right, 0px)); overflow: auto; scrollbar-width: thin; max-width: calc(100% - 2 * var(--map-inset)); }
.map-shell[data-placement="bottom"][data-controls-position="top"] .map-floating-controls { right: auto; left: max(var(--map-inset), env(safe-area-inset-left, 0px)); }
.map-floating-controls :deep(button), .map-floating-controls :deep(a) { pointer-events: auto; }
.map-feedback { position: absolute; z-index: 60; inset: auto var(--map-inset) var(--map-inset); pointer-events: none; }
.map-feedback :deep(button) { pointer-events: auto; }
.map-skip { position: absolute; z-index: 250; top: var(--gap-compact); left: var(--gap-compact); padding: var(--gap-standard); background: var(--chrome); color: var(--color-text); transform: translateY(-200%); }
.map-skip:focus { transform: none; outline: 3px solid var(--color-focus); }
@media (forced-colors: active) { .map-search, .map-rail { border: 1px solid CanvasText; } }
</style>
