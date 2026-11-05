<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading' })
</script>

<template>
  <span class="spinner" role="status"><svg class="ring" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle class="track" cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9" /></svg><span>{{ label }}</span></span>
</template>

<style scoped>
.spinner { display: inline-flex; align-items: center; gap: var(--gap-compact); color: var(--color-text); font: var(--font-small) / var(--line-body) var(--font-family-body); text-wrap: pretty; }
.ring { flex: none; width: var(--size-control-glyph); height: var(--size-control-glyph); animation: spinner-turn var(--motion-spin) linear infinite; }
.track { stroke: var(--color-border-soft); }
@keyframes spinner-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
</style>
