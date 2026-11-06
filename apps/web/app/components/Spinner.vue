<script setup lang="ts">
import AnimatedIcon from './AnimatedIcon.vue'
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading' })
</script>

<template>
  <span class="spinner" role="status"><AnimatedIcon class="ring" name="spinner" /><span>{{ label }}</span></span>
</template>

<style scoped>
.spinner { display: inline-flex; align-items: center; gap: var(--gap-compact); color: var(--color-text); font: var(--font-small) / var(--line-body) var(--font-family-body); text-wrap: pretty; }
.ring { flex: none; width: var(--size-control-glyph); height: var(--size-control-glyph); }
</style>
