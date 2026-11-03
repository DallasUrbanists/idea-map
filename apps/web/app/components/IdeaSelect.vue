<script setup lang="ts">
import { computed, useId } from 'vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  id?: string
  label: string
  modelValue: string
  options: readonly { value: string; label: string; disabled?: boolean }[]
  hint?: string
  error?: string
  required?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; blur: [event: FocusEvent] }>()
const generatedId = useId()
const controlId = computed(() => props.id || generatedId)
const describedBy = computed(() => [props.hint && `${controlId.value}-hint`, props.error && `${controlId.value}-error`].filter(Boolean).join(' ') || undefined)
</script>

<template>
  <div class="idea-select">
    <label :for="controlId">{{ label }}<span v-if="required"> (required)</span></label>
    <select v-bind="$attrs" :id="controlId" :value="modelValue" :required="required" :disabled="disabled"
      :aria-invalid="error ? true : undefined" :aria-describedby="describedBy"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)" @blur="emit('blur', $event)">
      <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option>
    </select>
    <p v-if="hint" :id="`${controlId}-hint`" class="hint">{{ hint }}</p>
    <p v-if="error" :id="`${controlId}-error`" class="error">Error: {{ error }}</p>
  </div>
</template>

<style scoped>
.idea-select { display: grid; gap: var(--space-2); min-width: 0; color: var(--color-text); font-family: var(--font-body); line-height: var(--line-body); }
label { font-weight: 700; overflow-wrap: anywhere; }
label span { font-weight: 400; }
select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-small); background: var(--color-surface); color: var(--color-text); font: inherit; }
select:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
[aria-invalid] { border-color: var(--color-danger); box-shadow: inset 0 0 0 1px var(--color-danger); }
:disabled { background: var(--color-surface-raised); color: var(--color-text-muted); cursor: not-allowed; }
p { margin: 0; font-size: var(--font-size-small); overflow-wrap: anywhere; }
.hint { color: var(--color-text-muted); }
.error { color: var(--color-danger); }
@media (forced-colors: active) { [aria-invalid] { border-style: double; border-width: 3px; } }
</style>
