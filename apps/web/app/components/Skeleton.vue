<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ label?: string; rows?: number; lead?: boolean }>(), { label: 'Loading ideas', rows: 3, lead: true })
const rowCount = computed(() => Number.isFinite(props.rows) ? Math.min(20, Math.max(1, Math.floor(props.rows))) : 3)
</script>

<template>
  <div class="skeleton" role="group" aria-busy="true" :aria-label="label">
    <div v-for="row in rowCount" :key="row" class="row corner-card shadow-grounded" aria-hidden="true"><span v-if="lead" class="lead" /><span class="line" /><span class="trailing" /></div>
  </div>
</template>

<style scoped>
.skeleton { display: grid; gap: var(--gap-compact); min-width: 0; }
.row { display: flex; align-items: center; gap: var(--gap-standard); min-height: var(--size-skeleton-row); padding-inline: var(--gap-standard); background: var(--card-surface); }
.row span { display: block; background: var(--inactive); border-radius: var(--radius-pill); }
.lead { flex: none; width: var(--size-skeleton-lead); height: var(--size-skeleton-lead); }
.line { flex: 1; min-width: 0; height: var(--size-skeleton-line); }
.trailing { flex: none; width: var(--size-skeleton-trailing); height: var(--size-skeleton-line); }
@media (forced-colors: active) { .row { border: 1px solid CanvasText; } .row span { background: GrayText; } }
</style>
