<script setup lang="ts">
import {
  DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal,
  DialogRoot, DialogTitle, DialogTrigger,
} from 'reka-ui'

defineProps<{ title: string; description: string }>()
</script>

<template>
  <DialogRoot>
    <DialogTrigger as-child><slot name="trigger" /></DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content">
        <div class="dialog-header">
          <DialogTitle class="dialog-title">{{ title }}</DialogTitle>
          <DialogClose class="dialog-close" type="button" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </DialogClose>
        </div>
        <DialogDescription class="dialog-description">{{ description }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgb(0 0 0 / 0.6);
}
.dialog-content {
  position: fixed;
  z-index: 101;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  width: min(32rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-floating);
  font: var(--font-body) / var(--line-body) var(--font-family-body);
  text-wrap: pretty;
}
.dialog-header { display: flex; align-items: flex-start; gap: var(--space-2); margin-bottom: var(--space-2); }
.dialog-title { flex: 1; min-width: 0; overflow-wrap: anywhere; margin: 0; font: 700 var(--font-heading) / var(--line-heading) var(--font-family-heading); }
.dialog-description { margin: 0 0 var(--space-4); color: var(--color-text-muted); }
.dialog-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  color: var(--color-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.dialog-close:hover { background: var(--color-surface-raised); }
.dialog-close:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
@media (max-width: 640px) { .dialog-content { padding: var(--space-4); } }
@media (forced-colors: active) { .dialog-content { box-shadow: none; } }
</style>
