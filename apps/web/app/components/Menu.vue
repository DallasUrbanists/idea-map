<script setup lang="ts">
import { ref } from 'vue'
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuItemIndicator } from 'reka-ui'
import Button from './Button.vue'
withDefaults(defineProps<{
  label: string
  items: readonly { value: string; label: string; disabled?: boolean; checked?: boolean }[]
  inline?: boolean
  side?: 'bottom' | 'left' | 'right' | 'top'
}>(), { side: 'bottom' })
const emit = defineEmits<{ select: [value: string]; check: [value: string, checked: boolean] }>()
const open = ref(false)
</script>

<template>
  <div v-if="inline" class="menu-inline" role="group" :aria-label="label">
    <button v-for="item in items" :key="item.value" type="button" class="menu-item" :disabled="item.disabled" :aria-pressed="item.checked"
      @click="item.checked === undefined ? emit('select', item.value) : emit('check', item.value, !item.checked)"><span>{{ item.label }}</span><span v-if="item.checked" aria-hidden="true">✓</span></button>
  </div>
  <DropdownMenuRoot v-else v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child><slot name="trigger"><Button variant="secondary">{{ label }}</Button></slot></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="menu-panel corner-control shadow-floating" :aria-label="label" :side="side" align="end" :side-offset="8" :collision-padding="8">
        <template v-for="item in items" :key="item.value">
          <DropdownMenuCheckboxItem v-if="item.checked !== undefined" class="menu-item" :model-value="item.checked" :disabled="item.disabled" @select.prevent @update:model-value="emit('check', item.value, $event)">
            <span>{{ item.label }}</span><DropdownMenuItemIndicator aria-hidden="true">✓</DropdownMenuItemIndicator>
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem v-else class="menu-item" :disabled="item.disabled" @select="emit('select', item.value)">{{ item.label }}</DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style>
.menu-panel { z-index: 100; box-sizing: border-box; min-width: min(12rem, calc(100vw - 1rem)); max-width: min(24rem, calc(100vw - 1rem)); max-height: var(--reka-dropdown-menu-content-available-height); overflow-y: auto; padding: var(--gap-tight); border: 1px solid var(--color-border); background: var(--chrome); color: var(--color-text); }
.menu-inline { display: flex; flex-wrap: wrap; gap: var(--gap-tight); }
.menu-item { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: var(--gap-standard); min-height: var(--size-minimum-tap-target); min-width: var(--size-minimum-tap-target); padding: var(--gap-compact) var(--gap-standard); border: 0; border-radius: var(--radius-control); background: var(--chrome); color: var(--color-text); font: var(--weight-medium) var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; overflow-wrap: anywhere; cursor: pointer; }
.menu-item[data-highlighted], .menu-item:hover:not(:disabled) { background: var(--color-surface-raised); }
.menu-item:focus-visible, .menu-item[data-highlighted] { outline: 3px solid var(--color-focus); outline-offset: 1px; }
.menu-item[data-state="checked"], .menu-item[aria-pressed="true"] { background: var(--color-selection); color: var(--color-selection-text); }
.menu-item[data-disabled], .menu-item:disabled { color: var(--color-text-muted); cursor: not-allowed; }
</style>
