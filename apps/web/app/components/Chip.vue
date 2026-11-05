<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'default' | 'muted' | 'accent' | 'solid' | 'inverse' | 'outline' | 'good' | 'warn' | 'alert' | 'critical' | 'highlight'
  small?: boolean
  mono?: boolean
}>(), { variant: 'default' })
</script>

<template><span :class="['chip', 'corner-control shadow-grounded', variant, { small, mono }]"><slot /></span></template>

<style scoped>
.chip { display: inline-block; box-sizing: border-box; max-width: 100%; padding: 0 var(--gap-compact); border: 1px solid transparent; background: var(--color-surface-raised); color: var(--color-text); font: var(--weight-semibold) var(--font-small) / var(--line-body) var(--font-family-body); text-wrap: pretty; overflow-wrap: anywhere; }
.muted { color: var(--color-text-muted); }
.accent { background: var(--accent-tint); color: var(--color-accent); }
.solid { background: var(--color-accent); color: var(--color-accent-text); }
.inverse { background: var(--color-text); color: var(--color-surface); }
.outline { background: var(--color-surface); border-color: var(--color-border); }
.good { background: var(--color-success); color: var(--color-success-text); }
.warn { background: var(--color-warning); color: var(--color-warning-text); }
.alert, .critical { background: var(--color-error); color: var(--color-error-text); }
.critical { border-color: currentColor; font-weight: var(--weight-bold); }
.highlight { background: var(--palette-marigold); color: var(--color-swatch-ink); }
.small { font-size: var(--font-caption); }
.mono { font-family: var(--font-mono); }
@media (forced-colors: active) { .chip { border-color: CanvasText; } }
</style>
