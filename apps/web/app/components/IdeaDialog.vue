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
        <DialogTitle class="idea-dialog-title">{{ title }}</DialogTitle>
        <DialogDescription class="idea-dialog-description">{{ description }}</DialogDescription>
        <slot />
        <DialogClose class="idea-dialog-close">Close</DialogClose>
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
.idea-dialog-title { margin: 0 0 var(--space-2); font: var(--font-size-heading) / var(--line-heading) var(--font-heading); }
.idea-dialog-description { margin: 0 0 var(--space-4); color: var(--color-text-muted); }
.idea-dialog-close {
  min-height: 44px;
  margin-top: var(--space-4);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text);
  background: var(--color-surface);
  font: inherit;
  cursor: pointer;
}
.idea-dialog-close:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
</style>
