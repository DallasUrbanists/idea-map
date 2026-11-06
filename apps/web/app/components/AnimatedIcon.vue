<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { LordIconElement } from '@lordicon/element'
import { iconAssets, type IconName } from './icon-assets'

const props = defineProps<{ name: IconName }>()
const assets = computed<{ reveal: string; hover?: string; loop?: string; noReveal?: boolean }>(() => iconAssets[props.name])
const root = ref<HTMLElement>()
const reveal = ref<LordIconElement>()
const hover = ref<LordIconElement>()
const loop = ref<LordIconElement>()
const active = ref(false)
const looping = ref(false)
let target: HTMLElement | null = null
let observer: IntersectionObserver | undefined
let motion: MediaQueryList | undefined
let alive = true
let pointerOver = false
let focused = false
function startHover() {
  if (motion?.matches || !hover.value || target?.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return
  active.value = true
  void hover.value.play({ from: 'start' })
}
function enterPointer() { pointerOver = true; startHover() }
function leavePointer() { pointerOver = false; if (!focused) active.value = false }
function enterFocus() { focused = true; startHover() }
function leaveFocus(event: FocusEvent) { focused = Boolean(event.relatedTarget instanceof Node && target?.contains(event.relatedTarget)); if (!focused && !pointerOver) active.value = false }
function updateMotion() {
  if (motion?.matches) {
    active.value = false; looping.value = false
    reveal.value?.seek('end'); hover.value?.stop(); loop.value?.stop()
  } else {
    if (assets.value.loop) looping.value = true
    if (pointerOver || focused) startHover()
  }
}
onMounted(async () => {
  const { defineElement } = await import('@lordicon/element')
  if (!alive) return
  defineElement()
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', updateMotion)
  target = root.value?.closest('button, a, [role="button"], [role^="menuitem"]') || null
  target?.addEventListener('mouseenter', enterPointer)
  target?.addEventListener('mouseleave', leavePointer)
  target?.addEventListener('focusin', enterFocus)
  target?.addEventListener('focusout', leaveFocus)
  observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    observer?.disconnect()
    if (motion?.matches) { updateMotion(); return }
    if (assets.value.noReveal) return
    void reveal.value?.play({ from: 'start' }).then(() => { if (alive && !motion?.matches && assets.value.loop) looping.value = true })
  }, { threshold: 0.5 })
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => {
  alive = false; observer?.disconnect(); motion?.removeEventListener('change', updateMotion)
  target?.removeEventListener('mouseenter', enterPointer); target?.removeEventListener('mouseleave', leavePointer)
  target?.removeEventListener('focusin', enterFocus); target?.removeEventListener('focusout', leaveFocus)
})
</script>

<template>
  <span ref="root" class="animated-icon" aria-hidden="true" :data-icon="name">
    <component :is="'lord-icon'" ref="reveal" :src="assets.reveal" current-color :class="{ hidden: active || looping }" />
    <component :is="'lord-icon'" v-if="assets.hover" ref="hover" :src="assets.hover" current-color :class="{ hidden: !active }" />
    <component :is="'lord-icon'" v-if="assets.loop" ref="loop" :src="assets.loop" current-color :trigger="looping ? 'loop' : undefined" :class="{ hidden: !looping }" />
  </span>
</template>

<style scoped>
.animated-icon { position: relative; display: inline-block; width: 20px; height: 20px; flex: none; line-height: 0; pointer-events: none; }
.animated-icon > * { position: absolute; inset: 0; width: 100%; height: 100%; }
.hidden { visibility: hidden; }
</style>
