<script setup lang="ts">
import Toggle from './Toggle.vue'
defineOptions({ inheritAttrs: false })
defineProps<{ id?: string; label: string; modelValue: boolean; disabled?: boolean; hint?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template><Toggle v-bind="$attrs" :id="id" :label="label" :model-value="modelValue" :disabled="disabled" :hint="hint" appearance="switch" @update:model-value="emit('update:modelValue', $event)" /></template>
