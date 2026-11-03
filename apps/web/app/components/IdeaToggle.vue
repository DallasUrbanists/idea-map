<script setup lang="ts">
import { computed, useId } from 'vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ id?: string; label: string; modelValue: boolean; disabled?: boolean; hint?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const generatedId = useId()
const controlId = computed(() => props.id || generatedId)
</script>

<template>
  <div class="idea-toggle">
    <label :for="controlId">
      <input v-bind="$attrs" :id="controlId" type="checkbox" role="switch" :checked="modelValue" :disabled="disabled"
        :aria-describedby="hint ? `${controlId}-hint` : undefined"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
      <span class="label">{{ label }}</span>
      <span class="state" aria-hidden="true">{{ modelValue ? 'On' : 'Off' }}</span>
    </label>
    <p v-if="hint" :id="`${controlId}-hint`">{{ hint }}</p>
  </div>
</template>

<style scoped>
.idea-toggle { color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; }
label { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; cursor: pointer; }
input { flex: 0 0 auto; width: 1.5rem; height: 1.5rem; margin: 0; accent-color: var(--color-accent); }
input:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
.label { flex: 1; min-width: 0; font-weight: 700; overflow-wrap: anywhere; }
.state { color: var(--color-text-muted); font-size: var(--font-small); }
label:has(:disabled) { cursor: not-allowed; color: var(--color-text-muted); }
p { margin: var(--space-1) 0 0; color: var(--color-text-muted); font-size: var(--font-small); overflow-wrap: anywhere; }
</style>
