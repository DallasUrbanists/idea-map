<script setup lang="ts">
import Button from './Button.vue'
import AnimatedIcon from './AnimatedIcon.vue'
withDefaults(defineProps<{
  variant?: 'surface' | 'inline' | 'compact'
  message: string
  description?: string
  retryLabel?: string
  retrying?: boolean
  retryingLabel?: string
}>(), { variant: 'surface', retryingLabel: 'Trying again...' })
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div :class="['error-state', 'corner-card shadow-grounded', variant]" role="group" :aria-label="message">
    <AnimatedIcon class="icon" name="warning" />
    <div class="body">
      <p class="message">{{ message }}</p>
      <p v-if="description" class="description">{{ description }}</p>
    </div>
    <Button v-if="variant !== 'compact' && retryLabel" :variant="'secondary'" :loading="retrying" :loading-label="retryingLabel" @click="emit('retry')">
      {{ retryLabel }}
    </Button>
  </div>
</template>

<style scoped>
.error-state {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gap-standard);
  padding: var(--gap-standard);
  background: var(--card-surface);
  color: var(--color-text);
  font: var(--font-body) / var(--line-body) var(--font-family-body);
  text-wrap: pretty;
  overflow-wrap: anywhere;
}

.icon {
  flex: none;
  width: var(--size-control-glyph);
  height: var(--size-control-glyph);
  color: var(--color-error);
}

.body {
  flex: 1 1 10rem;
  min-width: 0;
}

p {
  margin: 0;
}

.message {
  font-weight: var(--weight-semibold);
}

.description {
  color: var(--color-text-muted);
  font-size: var(--font-small);
}

.surface {
  flex-direction: column;
  padding: var(--gap-spread);
  text-align: center;
}

.surface .body {
  flex: auto;
  max-width: var(--size-reading-width);
}

.surface .icon {
  width: var(--size-alert-glyph);
  height: var(--size-alert-glyph);
}

.compact {
  display: inline-flex;
  gap: var(--gap-compact);
  padding: var(--gap-tight) var(--gap-compact);
  border-radius: var(--radius-pill);
  font-size: var(--font-small);
}

.compact .body {
  flex: auto;
}

.compact .icon {
  width: var(--size-metadata-glyph);
  height: var(--size-metadata-glyph);
}

@media (forced-colors: active) {
  .error-state {
    border: 1px solid CanvasText;
  }
}
</style>
