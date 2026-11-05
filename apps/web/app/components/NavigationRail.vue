<script setup lang="ts">
withDefaults(defineProps<{
  label?: string
  current: string
  items: readonly { value: string; label: string; href: string }[]
  capsule?: boolean
}>(), { label: 'Main navigation' })
</script>

<template>
  <nav :class="['nav-rail', { capsule }]" :aria-label="label">
    <a v-for="item in items" :key="item.value" :href="item.href" :aria-current="current === item.value ? 'page' : undefined">
      <span class="indicator" aria-hidden="true"><slot name="icon" :item="item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 10 9-7 9 7v11H3Z M9 21v-8h6v8" /></svg></slot></span>
      <span>{{ item.label }}</span>
    </a>
  </nav>
</template>

<style scoped>
.nav-rail { display: flex; flex-direction: column; gap: var(--gap-tight); width: var(--size-nav-rail); box-sizing: border-box; padding: var(--gap-compact) var(--gap-tight); border-inline-end: 1px solid var(--color-border-soft); background: var(--chrome); color: var(--color-text); }
a { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--gap-tight); min-height: var(--size-nav-rail-item); min-width: var(--size-minimum-tap-target); padding: var(--gap-tight); box-sizing: border-box; color: inherit; font: var(--weight-medium) var(--font-small) / var(--line-heading) var(--font-family-body); text-decoration: none; text-align: center; text-wrap: pretty; overflow-wrap: anywhere; border-radius: var(--radius-pill); }
.indicator { display: flex; justify-content: center; align-items: center; width: 100%; max-width: var(--size-nav-rail-indicator-width); min-height: var(--size-nav-rail-indicator-height); border-radius: var(--radius-pill); }
.indicator :deep(svg) { width: var(--size-inline-glyph); height: var(--size-inline-glyph); }
a[aria-current] { color: var(--color-accent); font-weight: var(--weight-semibold); }
a[aria-current] .indicator { background: var(--card-2); }
a:hover .indicator { background: var(--card-hover); }
a:active .indicator { background: var(--card-pressed); }
a:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 1px; }
.capsule { flex-direction: row; flex-wrap: wrap; gap: 0; width: fit-content; max-width: 100%; padding: var(--gap-tight); border: 1px solid var(--color-border-soft); border-radius: var(--radius-pill); box-shadow: var(--shadow-floating); }
.capsule a { flex: 1 1 0; min-width: calc(var(--size-nav-rail) + var(--gap-compact)); min-height: var(--size-floating-control); }
.capsule a .indicator { min-height: var(--size-inline-glyph); background: transparent; }
.capsule a[aria-current] { background: var(--card-2); }
.capsule a:hover { background: var(--card-hover); }
.capsule a:active { background: var(--card-pressed); }
@media (max-width: 760px) {
  .nav-rail:not(.capsule) { flex-direction: row; flex-wrap: wrap; width: 100%; border-inline-end: 0; border-block-start: 1px solid var(--color-border-soft); }
  .nav-rail a { flex: 1 1 0; }
  .capsule { width: 100%; }
  .capsule a { min-width: var(--size-minimum-tap-target); }
}
@media (forced-colors: active) {
  a[aria-current] .indicator { outline: 2px solid Highlight; }
  .capsule a[aria-current] { outline: 2px solid Highlight; outline-offset: -2px; }
  .capsule a[aria-current] .indicator { outline: none; }
}
</style>
