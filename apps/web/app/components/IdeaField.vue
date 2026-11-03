<script setup lang="ts">
import { computed, useId } from 'vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  id?: string
  label: string
  modelValue: string
  type?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url'
  multiline?: boolean
  hint?: string
  error?: string
  required?: boolean
  disabled?: boolean
}>(), { type: 'text' })
const emit = defineEmits<{ 'update:modelValue': [value: string]; blur: [event: FocusEvent] }>()
const generatedId = useId()
const controlId = computed(() => props.id || generatedId)
const describedBy = computed(() => [props.hint && `${controlId.value}-hint`, props.error && `${controlId.value}-error`].filter(Boolean).join(' ') || undefined)
</script>

<template>
  <div class="idea-field">
    <label :for="controlId">{{ label }}<span v-if="required"> (required)</span></label>
    <component :is="multiline ? 'textarea' : 'input'" v-bind="$attrs" :id="controlId"
      :type="multiline ? undefined : type" :value="modelValue" :required="required" :disabled="disabled"
      :aria-invalid="error ? true : undefined" :aria-describedby="describedBy"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement | HTMLTextAreaElement).value)"
      @blur="emit('blur', $event)" />
    <p v-if="hint" :id="`${controlId}-hint`" class="hint">{{ hint }}</p>
    <p v-if="error" :id="`${controlId}-error`" class="error">Error: {{ error }}</p>
  </div>
</template>

<style scoped>
.idea-field { display: grid; gap: var(--space-2); min-width: 0; color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; }
label { font-weight: 700; overflow-wrap: anywhere; }
label span { font-weight: 400; }
input, textarea { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-small); background: var(--color-surface); color: var(--color-text); font: inherit; }
textarea { min-height: 8rem; resize: vertical; }
input:focus-visible, textarea:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
[aria-invalid] { border-color: var(--color-error); box-shadow: inset 0 0 0 1px var(--color-error); }
:disabled { background: var(--color-surface-raised); color: var(--color-text-muted); cursor: not-allowed; }
p { margin: 0; font-size: var(--font-small); overflow-wrap: anywhere; }
.hint { color: var(--color-text-muted); }
.error { color: var(--color-error); }
@media (forced-colors: active) { [aria-invalid] { border: 1px solid; } }
</style>
