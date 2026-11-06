<script setup lang="ts">
withDefaults(defineProps<{ contentId?: string }>(), { contentId: 'main-content' })
</script>

<template>
  <div class="page-layout">
    <a class="skip-link" :href="`#${contentId}`">Skip to main content</a>
    <header class="page-header"><slot name="header" /></header>
    <div class="page-body">
      <div v-if="$slots.navigation" class="page-navigation"><slot name="navigation" /></div>
      <main :id="contentId" tabindex="-1" class="page-main"><slot /></main>
      <aside v-if="$slots.aside" class="page-aside"><slot name="aside" /></aside>
    </div>
  </div>
</template>

<style scoped>
.page-layout { display: flex; flex-direction: column; min-height: 100dvh; color: var(--color-text); background: var(--color-surface); font: var(--font-body) / var(--line-body) var(--font-family-body); }
.skip-link { position: fixed; inset: var(--gap-compact) auto auto var(--gap-compact); z-index: 200; padding: var(--gap-compact); color: var(--color-text); background: var(--color-surface); transform: translateY(-200%); }
.skip-link:focus { transform: none; outline: 3px solid var(--color-focus); }
.page-header { flex: none; padding: var(--gap-standard); border-bottom: 1px solid var(--color-border-soft); }
.page-body { display: flex; flex: 1; min-width: 0; }
.page-navigation { display: flex; flex: none; }
.page-main { flex: 1 1 auto; min-width: 0; padding: var(--gap-spread); }
.page-aside { flex: 0 1 var(--size-pane-wide); min-width: 0; padding: var(--gap-spread); border-inline-start: 1px solid var(--color-border-soft); }
@media (max-width: 760px) {
  .page-body { flex-direction: column; }
  .page-aside { flex-basis: auto; border-inline-start: 0; border-block-start: 1px solid var(--color-border-soft); }
  .page-main, .page-aside { padding: var(--gap-standard); }
}
</style>
