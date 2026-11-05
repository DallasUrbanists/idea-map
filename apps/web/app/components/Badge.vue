<template>
  <span class="badge corner-pill shadow-grounded"><span v-if="$slots.icon" class="icon" aria-hidden="true"><slot name="icon" /></span><slot /></span>
</template>

<style scoped>
.badge { display: inline-flex; align-items: center; gap: var(--gap-compact); max-width: 100%; box-sizing: border-box; padding: var(--gap-tight) var(--gap-standard); background: var(--accent-tint); color: var(--color-accent); font: var(--weight-bold) var(--font-small) / var(--line-body) var(--font-family-body); text-wrap: pretty; overflow-wrap: anywhere; }
.icon { display: inline-flex; flex: none; width: var(--size-inline-glyph); height: var(--size-inline-glyph); }
.icon :deep(svg) { width: 100%; height: 100%; }
@media (forced-colors: active) { .badge { border: 1px solid CanvasText; } }
</style>
