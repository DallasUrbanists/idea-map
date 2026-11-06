<script setup lang="ts">
import Button from './Button.vue'

defineProps<{ items: readonly { value: string; label: string }[]; visible: boolean }>()
const emit = defineEmits<{ select: [value: string] }>()
function keyboard(event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return
  const row = event.currentTarget as HTMLElement
  if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); row.scrollLeft = event.key === 'Home' ? 0 : row.scrollWidth }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); row.scrollLeft += event.key === 'ArrowRight' ? 80 : -80 }
}
</script>

<template>
  <Transition name="map-actions">
    <div v-if="visible" class="map-actions" role="group" aria-label="Map actions" tabindex="0" @keydown="keyboard">
      <Button v-for="item in items" :key="item.value" variant="badge" @click="emit('select', item.value)">{{ item.label }}</Button>
    </div>
  </Transition>
</template>

<style scoped>
.map-actions { display: flex; align-items: center; gap: var(--gap-compact); max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: thin; padding: var(--gap-tight); }
.map-actions:focus-visible { outline: 3px solid var(--color-focus); outline-offset: -3px; }
.map-actions-enter-active, .map-actions-leave-active { transition: opacity var(--motion-sheet) ease-out; }
.map-actions-enter-from, .map-actions-leave-to { opacity: 0; }
.map-actions-leave-active { pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .map-actions-enter-active, .map-actions-leave-active { transition: none; } }
</style>
