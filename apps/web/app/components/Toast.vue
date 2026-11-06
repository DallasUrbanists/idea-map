<script setup lang="ts">
import { onMounted, onBeforeUnmount, useId, watch, nextTick } from 'vue'
import { ToastProvider, ToastRoot, ToastTitle, ToastDescription, ToastAction, ToastClose, ToastViewport } from 'reka-ui'
import Button from './Button.vue'
import AnimatedIcon from './AnimatedIcon.vue'
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'loading'
  actionLabel?: string
  duration?: number
  inline?: boolean
  pill?: boolean
}>(), { tone: 'neutral', duration: 5000 })
const emit = defineEmits<{ 'update:open': [value: boolean]; action: [] }>()
const viewportId = useId()
let previousFocus: HTMLElement | null = null
function focusNotifications(event: KeyboardEvent) {
  if (props.open && event.altKey && event.code === 'KeyT') {
    event.preventDefault()
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.getElementById(viewportId)?.focus()
  }
}
onMounted(() => document.addEventListener('keydown', focusNotifications))
onBeforeUnmount(() => document.removeEventListener('keydown', focusNotifications))
watch(() => props.open, async open => {
  if (!open && previousFocus && document.getElementById(viewportId)?.contains(document.activeElement)) {
    await nextTick()
    previousFocus?.focus()
    previousFocus = null
  }
})
</script>

<template>
  <ToastProvider label="Notification" :duration="tone === 'loading' ? Infinity : duration">
    <ToastRoot :open="open" type="background" :class="['toast', 'corner-control shadow-floating', tone, { pill }]" @update:open="emit('update:open', $event)">
      <span v-if="tone !== 'neutral'" class="tone" aria-hidden="true"><AnimatedIcon :key="tone" :name="tone === 'loading' ? 'spinner' : tone" /></span>
      <div class="body"><ToastTitle class="title">{{ title }}</ToastTitle><ToastDescription v-if="description" class="description">{{ description }}</ToastDescription></div>
      <ToastAction v-if="actionLabel" :alt-text="actionLabel" as-child><Button variant="secondary" @click="emit('action')">{{ actionLabel }}</Button></ToastAction>
      <ToastClose as-child><Button variant="transparent" aria-label="Dismiss notification">Dismiss</Button></ToastClose>
    </ToastRoot>
    <ToastViewport :id="viewportId" :class="['toast-viewport', { inline }]" :hotkey="[]" label="Notifications (Alt+T)" />
  </ToastProvider>
</template>

<style>
.toast-viewport { position: fixed; inset-inline-end: var(--gap-spread); bottom: var(--gap-spread); z-index: 120; box-sizing: border-box; width: min(var(--size-pane-wide), calc(100% - var(--gap-spread) * 2)); max-height: calc(100dvh - var(--gap-spread) * 2); overflow-y: auto; margin: 0; padding: var(--gap-tight); list-style: none; }
.toast-viewport.inline { position: relative; inset: auto; width: 100%; max-height: none; }
.toast { display: flex; align-items: center; flex-wrap: wrap; gap: var(--gap-compact); padding: var(--gap-standard); border: 1px solid var(--color-border); background: var(--chrome); color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; overflow-wrap: anywhere; }
.toast .body { flex: 1 1 10ch; min-width: 0; }
.toast .title { font-weight: var(--weight-semibold); }
.toast .description { font-size: var(--font-small); color: var(--color-text-muted); margin-top: var(--gap-tight); }
.toast .tone { font-weight: var(--weight-bold); }
.toast.error { border-color: var(--color-error); }
.toast.error .tone { color: var(--color-error); }
.toast.pill { border-radius: var(--radius-pill); }
.toast:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 1px; }
</style>
