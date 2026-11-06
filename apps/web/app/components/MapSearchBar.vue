<script setup lang="ts">
import Button from './Button.vue'
import Input from './Input.vue'
import Menu from './Menu.vue'
import AnimatedIcon from './AnimatedIcon.vue'

withDefaults(defineProps<{
  modelValue: string
  foregroundOpen?: boolean
  canGoBack?: boolean
  historyOpen?: boolean
  panelId?: string
  destinations: readonly { value: string; label: string }[]
}>(), { foregroundOpen: false, canGoBack: false, historyOpen: false })
const emit = defineEmits<{ 'update:modelValue': [value: string]; search: []; history: []; back: []; close: []; navigate: [value: string] }>()
</script>

<template>
  <form class="map-search-bar shadow-floating" role="search" aria-label="Find places and ideas" @submit.prevent="emit('search')">
    <Button variant="transparent" icon-only :aria-label="canGoBack ? 'Back to previous view' : 'Show search history'"
      :aria-expanded="canGoBack ? undefined : historyOpen" :aria-controls="canGoBack ? undefined : panelId" @click="canGoBack ? emit('back') : emit('history')">
      <template #icon><svg v-if="canGoBack" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h15" /></svg><AnimatedIcon v-else name="history" /></template>
    </Button>
    <Input :model-value="modelValue" type="search" appearance="search-bar" label="Search places and ideas" placeholder="Search places and ideas" autocomplete="off" :aria-controls="panelId" @update:model-value="emit('update:modelValue', $event)" />
    <Button variant="transparent" icon-only type="submit" aria-label="Search">
      <template #icon><AnimatedIcon name="search" /></template>
    </Button>
    <span class="search-divider" aria-hidden="true"></span>
    <Button v-if="foregroundOpen" variant="transparent" icon-only aria-label="Close view and return to map" @click="emit('close')">
      <template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></template>
    </Button>
    <Menu v-else label="App menu" :items="destinations" @select="emit('navigate', $event)">
      <template #trigger><Button variant="transparent" icon-only aria-label="Open profile and app menu"><template #icon><AnimatedIcon name="avatar" /></template></Button></template>
    </Menu>
  </form>
</template>

<style scoped>
.map-search-bar { display: flex; align-items: center; box-sizing: border-box; gap: 0; min-height: var(--size-floating-control); padding: var(--gap-tight); width: 100%; border: 1px solid var(--color-border-soft); border-radius: var(--radius-pill); background: var(--chrome); color: var(--color-text); }
.map-search-bar :deep(.field) { flex: 1; min-width: 0; }
.map-search-bar :deep(.button) { flex: none; }
svg { width: var(--size-control-glyph); height: var(--size-control-glyph); }
.search-divider { align-self: stretch; margin: var(--gap-compact) var(--gap-tight); width: 1px; background: var(--color-border-soft); }
@media (max-width: 360px) { .map-search-bar { padding-inline: 0; } .search-divider { margin-inline: 0; } }
</style>
