<script setup lang="ts">
import { computed, useId } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ id?: string; label: string; modelValue: boolean; disabled?: boolean; hint?: string; appearance?: 'checkbox' | 'switch' }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const generatedId = useId()
const controlId = computed(() => props.id || generatedId)
</script>

<template>
  <div class="toggle" :class="{ 'switch-appearance': appearance === 'switch' }">
    <label :for="controlId">
      <input v-bind="$attrs" :id="controlId" type="checkbox" role="switch" :checked="modelValue" :disabled="disabled"
        :aria-describedby="hint ? `${controlId}-hint` : undefined"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
      <span class="label">{{ label }}</span>
      <span class="state" aria-hidden="true">{{ modelValue ? 'On' : 'Off' }}</span>
      <span v-if="appearance === 'switch'" class="switch-track corner-pill shadow-grounded" aria-hidden="true"><span /></span>
    </label>
    <p v-if="hint" :id="`${controlId}-hint`">{{ hint }}</p>
  </div>
</template>

<style scoped>
.toggle { color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; }
label { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; cursor: pointer; }
input { flex: 0 0 auto; width: 1.5rem; height: 1.5rem; margin: 0; accent-color: var(--color-accent); }
input:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
.label { flex: 1; min-width: 0; font-weight: 700; overflow-wrap: anywhere; }
.state { color: var(--color-text-muted); font-size: var(--font-small); }
label:has(:disabled) { cursor: not-allowed; color: var(--color-text-muted); }
p { margin: var(--space-1) 0 0; color: var(--color-text-muted); font-size: var(--font-small); overflow-wrap: anywhere; }
.switch-appearance { background: var(--chrome); }
.switch-appearance label { position: relative; gap: var(--gap-standard); min-width: var(--size-minimum-tap-target); }
.switch-appearance input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.switch-track { display: flex; align-items: center; flex: none; box-sizing: border-box; width: var(--size-switch-width); height: var(--size-switch-height); padding: var(--step-2); border: 1px solid var(--color-border); background: var(--color-text-muted); }
.switch-track > span { width: calc(var(--size-switch-thumb) - var(--step-2)); height: calc(var(--size-switch-thumb) - var(--step-2)); border-radius: var(--radius-pill); background: var(--color-surface); box-shadow: var(--shadow-glow); }
.switch-appearance input:checked ~ .switch-track { justify-content: flex-end; background: var(--color-accent); border-color: var(--color-accent); }
.switch-appearance input:checked ~ .switch-track > span { background: var(--color-accent-text); }
.switch-appearance input:focus-visible ~ .switch-track { outline: 3px solid var(--color-focus); outline-offset: 3px; }
.switch-appearance input:disabled ~ .switch-track { background: var(--color-surface-raised); border-style: dashed; }
@media (forced-colors: active) { .switch-track { background: Canvas; } .switch-track > span { background: CanvasText; } .switch-appearance input:checked ~ .switch-track { background: Highlight; } }
</style>
