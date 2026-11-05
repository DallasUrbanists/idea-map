<script setup lang="ts">
import { useAttrs } from 'vue'
import Tooltip from './Tooltip.vue'

defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'warning' | 'transparent'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
  loadingLabel?: string
  iconOnly?: boolean
}>(), { variant: 'primary', type: 'button', loadingLabel: 'Saving…' })
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const attrs = useAttrs()
defineSlots<{ default(): unknown; icon?(): unknown; loading?(): unknown }>()
</script>

<template>
  <Tooltip :enabled="Boolean(iconOnly && !disabled && attrs['aria-label'])" :label="String(attrs['aria-label'] || '')">
    <button v-bind="attrs" :type="type" :class="['button', 'corner-control', variant, { 'icon-only': iconOnly }]"
      :disabled="disabled" :aria-disabled="loading || undefined" :aria-busy="loading || undefined"
      @click="loading || disabled ? $event.preventDefault() : emit('click', $event)">
      <span v-if="loading">
        <slot name="loading">{{ loadingLabel }}</slot>
      </span>
      <template v-else><span v-if="$slots.icon" class="button-icon" aria-hidden="true">
          <slot name="icon" />
        </span>
        <slot />
      </template>
    </button>
  </Tooltip>
</template>

<style scoped>
.button {
  box-sizing: border-box;
  min-height: var(--size-minimum-tap-target);
  max-width: 100%;
  padding: var(--gap-compact) calc(2 * var(--gap-compact));
  border: 1px solid var(--button-border, var(--color-success));
  background: var(--button-background, var(--color-success));
  color: var(--button-color, var(--color-success-text));
  font: 700 var(--font-body) / var(--line-body) var(--font-family-body);
  text-wrap: pretty;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: all 0.1s ease-out;
  user-select: none;
}

.icon-only {
  position: relative;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-icon-button);
  height: var(--size-icon-button);
  padding: 0;
  border-radius: 50%;
}

.icon-only:disabled::after {
  content: '';
  position: absolute;
  width: 75%;
  height: 2px;
  background: currentColor;
  transform: rotate(-45deg);
}

.button-icon {
  position: relative;
  display: inline-block;
  line-height: 0;
  vertical-align: middle;
}

.button:not(.icon-only):disabled .button-icon::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 150%;
  height: 2px;
  background: currentColor;
  transform: translate(-50%, -50%) rotate(-45deg);
}

.secondary {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
}

.warning {
  background: var(--color-warning);
  color: var(--color-warning-text);
  border-color: var(--color-warning);
}

.transparent {
  background: transparent;
  color: var(--color-text);
  border-color: transparent;
}
.transparent:hover:not(:disabled):not([aria-disabled]) {
  background: var(--color-surface-raised);
}

.button:hover:not(:disabled):not([aria-disabled]) {
  filter: brightness(1.2);
}

.button:active:not(:disabled):not([aria-disabled]) {
  outline: 1px solid currentColor;
  outline-offset: -4px;
  filter: brightness(0.9);
}

.button:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}

.button:disabled,
.button[aria-disabled] {
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  border-color: var(--color-border-soft);
  cursor: not-allowed;
}

.button:disabled[aria-busy="true"],
.button[aria-disabled][aria-busy="true"] {
  cursor: wait;
}

.button:disabled {
  border-color: var(--color-border-soft);
}

.button[aria-busy="true"]:not(:disabled) {
  animation: button-loading-border 1.2s ease-in-out infinite;
}

@keyframes button-loading-border {
  50% {
    border-color: var(--color-text);
  }
}

@media (prefers-reduced-motion: reduce) {
  .button[aria-busy="true"]:not(:disabled) {
    animation: none;
  }
}

@media (forced-colors: active) {

  .button:disabled,
  .button[aria-disabled] {
    color: GrayText;
    border-color: GrayText;
  }

  .button[aria-busy="true"]:not(:disabled) {
    animation: none;
  }
}
</style>
