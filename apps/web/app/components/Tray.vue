<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import Button from './Button.vue'
import AnimatedIcon from './AnimatedIcon.vue'
import { allowedTrayRanks, snapTray, trayMetrics, trayOffset, type TrayRank } from '../composables/tray-state'
import type { SurfaceBounds } from '../composables/map-layout'

const props = withDefaults(defineProps<{ open: boolean; maximize?: boolean; label: string; placement?: 'bottom' | 'side'; mediumHeight?: number; maxHeight?: number; canDragOpen?: boolean; canDragClose?: boolean; busy?: boolean; showClose?: boolean }>(), { maximize: false, placement: 'bottom', mediumHeight: 320, maxHeight: 520, canDragOpen: true, canDragClose: true, busy: false, showClose: true })
const emit = defineEmits<{ 'update:open': [value: boolean]; 'update:maximize': [value: boolean]; scroll: [event: Event]; geometry: [value: SurfaceBounds] }>()
const root = ref<HTMLElement>()
const element = ref<HTMLElement>()
const head = ref<HTMLElement>()
const contentElement = ref<HTMLElement>()
const bodyContent = ref<HTMLElement>()
const handle = ref<HTMLButtonElement>()
const bodyId = `tray-body-${useId()}`
const natural = ref(1)
const available = ref(props.maxHeight)
const metrics = computed(() => trayMetrics(natural.value, props.mediumHeight, props.maxHeight, available.value))
const rank = computed<TrayRank>(() => !props.open ? 0 : props.maximize && metrics.value.scrollable ? 2 : 1)
const dragOffset = ref<number | null>(null)
const offset = computed(() => dragOffset.value ?? trayOffset(rank.value, metrics.value))
const visibleHeight = computed(() => Math.max(0, metrics.value.height - offset.value))
const dragging = ref(false)
const showHandle = computed(() => props.placement === 'bottom' && (props.open ? props.canDragClose || (!props.maximize && props.canDragOpen) : props.canDragOpen))
const displayedHeight = computed(() => Math.max(showHandle.value ? 44 : 0, visibleHeight.value))
let observer: ResizeObserver | undefined
let mutations: MutationObserver | undefined
let frame = 0
let previousFocus: HTMLElement | null = null
let suppressClick = false
let gesture: { pointer: number; start: number; offset: number; rank: TrayRank; moved: boolean; samples: { y: number; time: number }[] } | null = null

function reportGeometry() {
  if (!element.value || !root.value) return
  const box = root.value.getBoundingClientRect()
  const active = props.open || dragging.value || showHandle.value
  const height = props.placement === 'bottom' ? displayedHeight.value : box.height
  const top = props.placement === 'bottom' ? box.bottom - height : box.top
  emit('geometry', { top, left: box.left, right: active ? box.right : box.left, bottom: active ? box.bottom : top, width: active ? box.width : 0, height: active ? height : 0, dragging: dragging.value })
}
function measure() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    available.value = Math.min(root.value?.clientHeight || props.maxHeight, window.visualViewport?.height ?? window.innerHeight)
    natural.value = (head.value?.scrollHeight || 0) + (bodyContent.value?.scrollHeight || 0) + (showHandle.value ? 44 : 0) + 2
    if (props.placement === 'bottom' && !metrics.value.scrollable && props.maximize) emit('update:maximize', false)
    reportGeometry()
  })
}
function setRank(value: TrayRank) {
  emit('update:open', value > 0)
  if (props.placement === 'bottom' && value > 0) emit('update:maximize', value === 2 && metrics.value.scrollable)
}
function changeStep(direction: -1 | 1) {
  const next = Math.max(0, Math.min(metrics.value.scrollable ? 2 : 1, rank.value + direction)) as TrayRank
  if (allowedTrayRanks(rank.value, metrics.value.scrollable, props.canDragOpen, props.canDragClose).includes(next)) setRank(next)
}
function keyboard(event: KeyboardEvent) {
  if (props.busy) return
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); changeStep(event.key === 'ArrowUp' ? 1 : -1) }
  if (event.key === 'Home' && props.canDragClose) { event.preventDefault(); setRank(0) }
  if (event.key === 'End' && props.canDragOpen) { event.preventDefault(); setRank(metrics.value.scrollable ? 2 : 1) }
}
function start(event: PointerEvent) {
  if (props.busy || event.button !== 0 || !event.isPrimary || !showHandle.value) return
  event.preventDefault()
  suppressClick = false
  const startOffset = trayOffset(rank.value, metrics.value)
  gesture = { pointer: event.pointerId, start: event.clientY, offset: startOffset, rank: rank.value, moved: false, samples: [{ y: event.clientY, time: event.timeStamp }] }
  dragOffset.value = startOffset
  dragging.value = true
  handle.value?.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!gesture || gesture.pointer !== event.pointerId) return
  const delta = event.clientY - gesture.start
  const limits = allowedTrayRanks(gesture.rank, metrics.value.scrollable, props.canDragOpen, props.canDragClose).map(value => trayOffset(value, metrics.value))
  dragOffset.value = Math.max(Math.min(...limits), Math.min(Math.max(...limits), gesture.offset + delta))
  gesture.moved ||= Math.abs(delta) > 4
  gesture.samples = gesture.samples.filter(sample => event.timeStamp - sample.time <= 120)
  gesture.samples.push({ y: event.clientY, time: event.timeStamp })
  reportGeometry()
}
function finish(event?: PointerEvent, cancelled = false) {
  if (!gesture || (event && gesture.pointer !== event.pointerId)) return
  const active = gesture
  const samples = [...active.samples.filter(sample => !event || event.timeStamp - sample.time <= 120), ...(event ? [{ y: event.clientY, time: event.timeStamp }] : [])]
  const first = samples[0]!
  const last = samples[samples.length - 1]!
  const distance = last.y - first.y
  const velocity = distance / Math.max(16, last.time - first.time)
  const target = cancelled ? active.rank : snapTray(active.rank, dragOffset.value ?? active.offset, metrics.value, props.canDragOpen, props.canDragClose, velocity, distance)
  suppressClick = active.moved
  gesture = null
  dragging.value = false
  dragOffset.value = null
  if (handle.value?.hasPointerCapture(active.pointer)) handle.value.releasePointerCapture(active.pointer)
  if (!cancelled) setRank(target)
  reportGeometry()
}
function toggle(event: MouseEvent) {
  if (suppressClick && event.detail !== 0) { suppressClick = false; return }
  suppressClick = false
  if (props.busy) return
  if (props.open && props.canDragClose) setRank(0)
  else if (!props.open && props.canDragOpen) setRank(1)
}
function wheel(event: WheelEvent) {
  if (!props.open || props.busy || props.placement !== 'bottom' || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  let target = event.target instanceof HTMLElement ? event.target : null
  while (target && target !== contentElement.value && element.value?.contains(target)) {
    if (target.scrollHeight > target.clientHeight && /auto|scroll/.test(getComputedStyle(target).overflowY)
      && (event.deltaY > 0 ? target.scrollTop + target.clientHeight < target.scrollHeight - 1 : target.scrollTop > 0)) return
    target = target.parentElement
  }
  if (metrics.value.scrollable && !props.maximize && props.canDragOpen && event.deltaY > 0) { event.preventDefault(); setRank(2) }
  else if (props.maximize && props.canDragClose && event.deltaY < 0 && (contentElement.value?.scrollTop || 0) <= 0) { event.preventDefault(); setRank(1) }
}
watch(() => props.open, async open => {
  if (open) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  else {
    const restore = element.value?.contains(document.activeElement)
    await nextTick()
    if (restore && previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true })
  }
  measure()
})
watch(() => [props.placement, props.mediumHeight, props.maxHeight, props.busy], () => { finish(undefined, true); measure() })
watch([() => props.open, () => props.maximize, displayedHeight, dragging, showHandle], reportGeometry)
onMounted(() => {
  observer = new ResizeObserver(measure)
  for (const target of [root.value, head.value, bodyContent.value]) if (target) observer.observe(target)
  mutations = new MutationObserver(measure)
  if (bodyContent.value) mutations.observe(bodyContent.value, { childList: true, subtree: true, characterData: true })
  window.visualViewport?.addEventListener('resize', measure)
  measure()
})
onBeforeUnmount(() => { observer?.disconnect(); mutations?.disconnect(); window.visualViewport?.removeEventListener('resize', measure); cancelAnimationFrame(frame) })
defineExpose({ element, contentElement })
</script>

<template>
  <div ref="root" class="tray-layer" :class="{ 'has-handle': showHandle }" :data-position="open ? (placement === 'bottom' && maximize && metrics.scrollable ? 'max' : 'medium') : 'closed'" :data-placement="placement" :data-scrollable="metrics.scrollable">
    <div class="tray-shell" :class="{ dragging, closed: !open }" :style="placement === 'bottom' ? { height: `${displayedHeight}px` } : undefined">
      <aside ref="element" class="tray-surface" :aria-label="label" :aria-busy="busy || undefined" :aria-hidden="!open && !dragging ? true : undefined" :inert="!open && !dragging" @wheel="wheel">
        <div ref="head" class="tray-head">
          <div class="tray-heading"><slot name="head"><h1>{{ label }}</h1></slot></div>
          <div class="tray-actions">
            <Button v-if="placement === 'bottom' && metrics.scrollable" variant="transparent" icon-only :aria-label="maximize ? 'Reduce tray' : 'Expand tray'" :disabled="busy || (maximize ? !canDragClose : !canDragOpen)" :aria-expanded="maximize" :aria-controls="bodyId" @click="setRank(maximize ? 1 : 2)"><template #icon><AnimatedIcon :key="maximize ? 'collapse' : 'expand'" :name="maximize ? 'collapse' : 'expand'" /></template></Button>
            <Button v-if="showClose" variant="transparent" icon-only :disabled="busy" aria-label="Close tray" @click="setRank(0)"><template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></template></Button>
          </div>
        </div>
        <div :id="bodyId" ref="contentElement" class="tray-body" :tabindex="metrics.scrollable ? 0 : undefined" @scroll="emit('scroll', $event)"><div ref="bodyContent" class="tray-body-content"><slot /></div></div>
      </aside>
      <button v-if="showHandle" ref="handle" class="tray-handle" type="button" :aria-label="open ? 'Close tray' : 'Open tray'" :aria-expanded="open" :aria-controls="bodyId" :disabled="busy"
        @pointerdown="start" @pointermove="move" @pointerup="finish($event)" @pointercancel="finish($event, true)" @lostpointercapture="finish($event, true)" @click="toggle" @keydown="keyboard"><span class="tray-grip" aria-hidden="true"></span></button>
    </div>
  </div>
</template>

<style scoped>
.tray-layer { position: absolute; inset: 0; overflow: clip; pointer-events: none; }
.tray-shell { position: absolute; inset: auto 0 0; transition: height var(--motion-sheet) ease-out, transform var(--motion-sheet) ease-out; pointer-events: none; }
.tray-surface { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; pointer-events: auto; color: var(--color-text); background: var(--chrome); border: 1px solid var(--color-border-soft); border-radius: var(--radius-card) var(--radius-card) 0 0; box-shadow: var(--shadow-floating); font: var(--font-body) / var(--line-body) var(--font-family-body); }
.tray-layer[data-placement="bottom"].has-handle .tray-surface { padding-top: var(--size-minimum-tap-target); }
.closed .tray-surface { pointer-events: none; }
.tray-head { display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--gap-compact); padding: var(--gap-standard); border-bottom: 1px solid var(--color-border-soft); }
.tray-heading { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.tray-heading :deep(h1), .tray-heading h1 { margin: 0; font: var(--weight-bold) var(--font-heading) / var(--line-heading) var(--font-family-heading); }
.tray-actions { display: flex; align-items: center; gap: var(--gap-tight); }
.tray-actions svg { width: var(--size-inline-glyph); height: var(--size-inline-glyph); }
.tray-body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding-bottom: env(safe-area-inset-bottom, 0px); }
.tray-body:focus-visible { outline: 3px solid var(--color-focus); outline-offset: -3px; }
.tray-body-content { display: flow-root; overflow-wrap: anywhere; }
.tray-handle { position: absolute; inset: 0 0 auto; display: flex; align-items: flex-start; justify-content: center; width: 100%; height: var(--size-minimum-tap-target); padding: 0; border: 0; background: transparent; color: var(--color-text); cursor: grab; touch-action: none; pointer-events: auto; }
.tray-handle:focus-visible { outline: 3px solid var(--color-focus); outline-offset: -3px; }
.tray-grip { display: block; width: calc(2 * var(--size-floating-control)); height: var(--gap-tight); margin-top: var(--gap-compact); border-radius: var(--radius-pill); background: var(--color-text-muted); }
.dragging { transition: none; }
.tray-layer[data-placement="side"] .tray-shell { inset: 0; height: 100%; transform: none; }
.tray-layer[data-placement="side"] .tray-surface { height: 100%; border-radius: 0 var(--radius-card) 0 0; }
.tray-layer[data-placement="side"] .closed { transform: translateX(-110%); }
@media (prefers-reduced-motion: reduce) { .tray-shell { transition: none; } }
@media (forced-colors: active) { .tray-surface { border-color: CanvasText; box-shadow: none; } .tray-grip { background: ButtonText; } }
</style>
