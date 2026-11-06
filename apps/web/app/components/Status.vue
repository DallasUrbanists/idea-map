<script setup lang="ts">
import AnimatedIcon from './AnimatedIcon.vue'
withDefaults(defineProps<{ tone?: 'info' | 'success' | 'warning' | 'error'; live?: 'off' | 'polite' | 'assertive'; variant?: 'banner' | 'text' | 'pill' }>(), { tone: 'info', live: 'off', variant: 'banner' })
defineSlots<{ default(): unknown }>()
</script>

<template>
  <div :class="['status', tone, variant]" :role="live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined" :aria-live="live" aria-atomic="true">
    <span class="symbol" aria-hidden="true"><AnimatedIcon :key="tone" :name="tone" /></span>
    <div><strong v-if="variant === 'banner'">{{ { info: 'Information', success: 'Success', warning: 'Warning', error: 'Error' }[tone] }}: </strong><slot /></div>
  </div>
</template>

<style scoped>
.status { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-surface-raised); color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; overflow-wrap: anywhere; }
.symbol { flex: 0 0 1.25em; text-align: center; line-height: 0; }
.symbol :deep(.animated-icon) { width: 1em; height: 1em; }
.status > div { min-width: 0; }
.error { border-color: var(--color-error); color: var(--color-error); background: var(--color-surface); }
.text, .pill { display: inline-flex; align-items: center; gap: var(--gap-tight); max-width: 100%; box-sizing: border-box; border: 0; font-size: var(--font-small); font-weight: var(--weight-semibold); }
.text { padding: 0; background: transparent; }
.text.success { color: var(--good); }
.text.warning { color: var(--warn); }
.text.info { color: var(--color-text-muted); }
.pill { padding: var(--gap-tight) var(--gap-compact); border-radius: var(--radius-pill); }
.pill.success { background: var(--color-success); color: var(--color-success-text); }
.pill.warning { background: var(--color-warning); color: var(--color-warning-text); }
.pill.error { background: var(--color-error); color: var(--color-error-text); }
@media (forced-colors: active) { .pill { border: 1px solid CanvasText; } }
</style>
