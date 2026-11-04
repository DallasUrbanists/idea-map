<script setup lang="ts">
defineProps<{ empty?: boolean; hairline?: boolean }>()
</script>

<template>
  <div :class="['card', 'corner-card shadow-grounded', { empty, hairline }]">
    <div v-if="$slots.header" class="header">
      <slot name="header" />
    </div>
    <div class="body">
      <slot />
    </div>
    <div v-if="$slots.footer" class="footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.card {
  box-sizing: border-box;
  display: grid;
  gap: var(--gap-standard);
  min-width: 0;
  padding: var(--gap-standard);
  background: var(--card-surface);
  color: var(--color-text);
  font: var(--font-body) / var(--line-body) var(--font-family-body);
  text-wrap: pretty;
  overflow-wrap: anywhere;
}

.body,
.header,
.footer {
  min-width: 0;
}

.empty {
  padding: var(--gap-spread);
  text-align: center;
  color: var(--color-text-muted);
}

.hairline {
  border: 1px solid var(--color-border-soft);
}

.footer {
  margin-top: var(--gap-standard);
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-compact);
}

@media (forced-colors: active) {
  .card {
    border: 1px solid CanvasText;
  }
}
</style>
