<script setup lang="ts">
import { ref } from 'vue'
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(defineProps<{ label: string; enabled?: boolean; variant?: 'default' | 'warning' }>(), { enabled: true, variant: 'default' })
const open = ref(false)
const surfaceStyle = ref<Record<string, string>>({})

// A portalled surface no longer inherits the trigger's local theme.
function captureSurfaceStyle(event: Event) {
  const trigger = event.currentTarget
  if (!(trigger instanceof HTMLElement)) return
  const style = getComputedStyle(trigger)
  const names = [
    '--color-surface-raised', '--color-text', '--color-border', '--color-warning', '--color-warning-text',
    '--gap-compact', '--radius-control', '--shadow-floating', '--font-small', '--line-body', '--font-family-body',
  ]
  surfaceStyle.value = Object.fromEntries(names.map(name => [name, style.getPropertyValue(name).trim()]))
  surfaceStyle.value.direction = style.direction
}

function closeOnTouch(event: PointerEvent) {
  if (event.pointerType === 'touch') open.value = false
}
</script>

<template>
  <TooltipProvider v-if="enabled" :delay-duration="400">
    <TooltipRoot v-model:open="open">
      <TooltipTrigger as-child @pointerdown="closeOnTouch" @pointermove="captureSurfaceStyle"
        @focus="captureSurfaceStyle">
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent :class="['tooltip', 'corner-control shadow-floating', { 'tooltip-warning': variant === 'warning' }]"
          :style="surfaceStyle" :side-offset="8" :collision-padding="8">{{ label }}</TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
  <slot v-else />
</template>

<style>
.tooltip {
  box-sizing: border-box;
  z-index: 110;
  max-width: min(20rem, calc(100vw - 1rem));
  max-height: calc(100dvh - 1rem);
  overflow: auto;
  padding: var(--gap-compact);
  border: 1px solid var(--color-border);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: var(--font-small) / var(--line-body) var(--font-family-body);
  text-wrap: pretty;
  overflow-wrap: anywhere;
}
</style>
