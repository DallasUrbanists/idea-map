<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'info' | 'success' | 'warning' | 'error'; live?: 'off' | 'polite' | 'assertive' }>(), { tone: 'info', live: 'off' })
defineSlots<{ default(): unknown }>()
</script>

<template>
  <div :class="['idea-status', tone]" :role="live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined" :aria-live="live" aria-atomic="true">
    <span class="symbol" aria-hidden="true">{{ { info: 'i', success: '✓', warning: '!', error: '×' }[tone] }}</span>
    <div><strong>{{ { info: 'Information', success: 'Success', warning: 'Warning', error: 'Error' }[tone] }}:</strong> <slot /></div>
  </div>
</template>

<style scoped>
.idea-status { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-small); background: var(--color-surface-raised); color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; overflow-wrap: anywhere; }
.symbol { flex: 0 0 1.25em; text-align: center; font-family: var(--font-family-heading); font-weight: 700; }
.idea-status > div { min-width: 0; }
.error { border-color: var(--color-error); color: var(--color-error); background: var(--color-surface); }
</style>
