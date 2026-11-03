<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'danger'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
  loadingLabel?: string
}>(), { variant: 'primary', type: 'button', loadingLabel: 'Saving…' })
const emit = defineEmits<{ click: [event: MouseEvent] }>()
defineSlots<{ default(): unknown }>()
</script>

<template>
  <button :type="type" :class="['idea-button', variant]" :disabled="disabled"
    :aria-disabled="loading || undefined" :aria-busy="loading || undefined"
    @click="loading || disabled ? $event.preventDefault() : emit('click', $event)">
    <span v-if="loading">{{ loadingLabel }}</span>
    <slot v-else />
  </button>
</template>

<style scoped>
.idea-button {
  min-height: 44px; max-width: 100%; padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-accent); border-radius: var(--radius-small);
  background: var(--color-accent); color: var(--color-accent-text);
  font: inherit; font-family: var(--font-body); line-height: var(--line-body);
  overflow-wrap: anywhere; cursor: pointer;
}
.secondary { background: var(--color-surface); color: var(--color-text); border-color: var(--color-border); }
.danger { background: var(--color-surface); color: var(--color-danger); border-color: var(--color-danger); }
.idea-button:hover:not(:disabled):not([aria-disabled]) { text-decoration: underline; text-underline-offset: 0.2em; }
.idea-button:active:not(:disabled):not([aria-disabled]) { outline: 1px solid currentColor; outline-offset: -4px; }
.idea-button:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
.idea-button:disabled, .idea-button[aria-disabled] { background: var(--color-surface-raised); color: var(--color-text-muted); border-color: var(--color-border); cursor: not-allowed; }
@media (forced-colors: active) { .idea-button:disabled { color: GrayText; border-color: GrayText; } }
</style>
