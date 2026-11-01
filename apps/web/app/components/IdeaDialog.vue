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
      <DialogOverlay class="idea-dialog-overlay" />
      <DialogContent class="idea-dialog-content">
        <div class="idea-dialog-header">
          <DialogTitle class="idea-dialog-title">{{ title }}</DialogTitle>
          <DialogClose class="idea-dialog-close" type="button" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </DialogClose>
        </div>
        <DialogDescription class="idea-dialog-description">{{ description }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.idea-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgb(0 0 0 / 0.6);
}
.idea-dialog-content {
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
  border-radius: var(--radius-medium);
  color: var(--color-text);
  background: var(--color-surface);
  font-family: var(--font-body);
  line-height: var(--line-body);
}
.idea-dialog-header { display: flex; align-items: flex-start; gap: var(--space-2); margin-bottom: var(--space-2); }
.idea-dialog-title { flex: 1; min-width: 0; overflow-wrap: anywhere; margin: 0; font: var(--font-size-heading) / var(--line-heading) var(--font-heading); }
.idea-dialog-description { margin: 0 0 var(--space-4); color: var(--color-text-muted); }
.idea-dialog-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-small);
  color: var(--color-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.idea-dialog-close:hover { background: var(--color-surface-raised); }
.idea-dialog-close:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
</style>
