<script setup lang="ts">
import { computed, useId } from 'vue'
const props = defineProps<{ label: string; value?: number; max?: number; hint?: string }>()
const id = useId()
const maximum = computed(() => Number.isFinite(props.max) && props.max! > 0 ? props.max! : 100)
const progress = computed(() => props.value === undefined || !Number.isFinite(props.value) ? undefined : Math.min(maximum.value, Math.max(0, props.value)))
const percent = computed(() => progress.value === undefined ? undefined : Math.round(progress.value / maximum.value * 100))
</script>

<template>
  <div class="progress">
    <div class="heading"><label :for="id">{{ label }}</label><span aria-hidden="true">{{ percent === undefined ? 'Working…' : `${percent}%` }}</span></div>
    <progress :id="id" :value="progress" :max="maximum" :aria-describedby="hint ? `${id}-hint` : undefined" />
    <p v-if="hint" :id="`${id}-hint`">{{ hint }}</p>
  </div>
</template>

<style scoped>
.progress { display: grid; gap: var(--space-2); min-width: 0; color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; }
.heading { display: flex; justify-content: space-between; gap: var(--space-3); }
label { overflow-wrap: anywhere; min-width: 0; }
.heading span { flex-shrink: 0; color: var(--color-text-muted); }
progress { appearance: none; box-sizing: border-box; width: 100%; height: 1rem; border: 1px solid var(--color-border); border-radius: var(--radius-pill); overflow: hidden; background: var(--color-surface); color: var(--color-accent); }
progress::-webkit-progress-bar { background: var(--color-surface); }
progress::-webkit-progress-value { background: var(--color-accent); }
progress::-moz-progress-bar { background: var(--color-accent); }
progress:indeterminate { background: repeating-linear-gradient(90deg, var(--color-accent) 0 1rem, var(--color-surface) 1rem 2rem); }
progress:indeterminate::-webkit-progress-bar { background: transparent; }
p { margin: 0; color: var(--color-text-muted); font-size: var(--font-small); overflow-wrap: anywhere; }
@media (forced-colors: active) { progress { appearance: auto; } }
</style>
