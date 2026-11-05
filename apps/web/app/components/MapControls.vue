<script setup lang="ts">
import Button from './Button.vue'
import Menu from './Menu.vue'
withDefaults(defineProps<{
  zoom: number
  minZoom?: number
  maxZoom?: number
  following?: boolean
  locating?: boolean
  error?: string
  layers?: readonly { value: string; label: string; checked: boolean; disabled?: boolean }[]
}>(), { minZoom: 1, maxZoom: 20 })
const emit = defineEmits<{ 'update:zoom': [value: number]; recenter: []; layer: [value: string, checked: boolean]; attribution: [] }>()
</script>

<template>
  <div class="map-area">
    <Menu v-if="layers?.length" label="Map layers" :items="layers" side="left" @check="(value, checked) => emit('layer', value, checked)" />
    <div class="map-controls corner-control shadow-floating" role="group" aria-label="Map controls">
      <Button variant="transparent" icon-only aria-label="Zoom in" :disabled="zoom >= maxZoom" @click="emit('update:zoom', Math.min(maxZoom, zoom + 1))"><template #icon><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg></template></Button>
      <Button variant="transparent" icon-only aria-label="Zoom out" :disabled="zoom <= minZoom" @click="emit('update:zoom', Math.max(minZoom, zoom - 1))"><template #icon><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" /></svg></template></Button>
      <Button variant="transparent" icon-only :aria-label="locating ? 'Finding your location' : 'Recenter map'" :aria-pressed="following" :loading="locating" @click="emit('recenter')"><template #icon><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" :fill="following ? 'currentColor' : 'none'" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></svg></template><template #loading><span aria-hidden="true">…</span></template></Button>
    </div>
    <Button variant="transparent" @click="emit('attribution')">Map attribution</Button>
    <span class="zoom" aria-hidden="true">Zoom {{ zoom }}</span>
    <p v-if="error" class="error" role="status">{{ error }}</p>
  </div>
</template>

<style scoped>
.map-area { display: flex; flex-direction: column; align-items: flex-end; gap: var(--gap-compact); color: var(--color-text); font: var(--font-small) / var(--line-body) var(--font-family-body); text-wrap: pretty; }
.map-controls { display: flex; flex-direction: column; padding: var(--gap-tight); border: 1px solid var(--color-border); background: var(--chrome); }
.map-controls :deep(svg) { width: var(--size-map-control-glyph); height: var(--size-map-control-glyph); fill: none; stroke: currentColor; stroke-width: 2; }
.map-controls :deep(.button) { border-radius: var(--radius-control); }
.map-controls :deep([aria-pressed="true"]) { background: var(--color-selection); color: var(--color-selection-text); }
.zoom { padding: var(--gap-tight) var(--gap-compact); border-radius: var(--radius-control); background: var(--chrome); font-variant-numeric: tabular-nums; }
.error { max-width: var(--size-pane-narrow); margin: 0; padding: var(--gap-compact); background: var(--chrome); color: var(--color-error); }
</style>
