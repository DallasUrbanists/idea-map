<script setup lang="ts">
import { useId } from "vue";
withDefaults(
  defineProps<{
    label: string;
    modelValue: string;
    options: readonly { value: string; label: string; disabled?: boolean }[];
    layout?: "content" | "fill" | "scroll";
    disabled?: boolean;
  }>(),
  { layout: "content" },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const groupId = useId();
</script>

<template>
  <fieldset
    class="segments"
    :class="['corner-control', layout]"
    :disabled="disabled"
    role="radiogroup"
    :aria-labelledby="`${groupId}-label`"
  >
    <div class="track corner-control">
      <label
        v-for="option in options"
        :key="option.value"
        class="segment"
        :class="{ selected: option.value === modelValue }"
      >
        <input
          type="radio"
          :name="groupId"
          :value="option.value"
          :checked="option.value === modelValue"
          :disabled="option.disabled"
          @change="emit('update:modelValue', option.value)"
        />
        <span>{{ option.label }}</span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.segments {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 0;
  min-inline-size: 0;
  max-width: 100%;
  color: var(--color-text-muted);
  font: var(--font-body) / var(--line-body) var(--font-family-body);
  text-wrap: pretty;
}
legend {
  padding: 0;
  margin-bottom: var(--gap-compact);
  font-size: var(--font-small);
  font-weight: var(--weight-semibold);
}
.track {
  display: inline-flex;
  max-width: 100%;
  box-sizing: border-box;
  padding: var(--gap-tight);
  gap: var(--gap-tight);
  border: 1px solid var(--color-border-soft);
  background: var(--color-border-soft);
  box-shadow: inset 0 2px 2px rgb(16 26 46 / 18%);
}
.segment {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-tight);
  box-sizing: border-box;
  min-width: var(--size-minimum-tap-target);
  min-height: var(--size-minimum-tap-target);
  padding: var(--gap-compact);
  border-radius: var(--radius-control);
  font-weight: var(--weight-semibold);
  overflow-wrap: anywhere;
  user-select: none;
}
input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}
.check {
  flex: none;
  width: 1em;
}
.selected {
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-drag);
}
.segment:has(input:focus-visible) {
  outline: 3px solid var(--color-focus);
  outline-offset: 1px;
}
.segment:hover:not(:has(:disabled)):not(.selected) {
  background: var(--color-selection);
  color: var(--color-selection-text);
  cursor: pointer;
}
.segment:active:not(:has(:disabled)):not(.selected) {
  background: var(--color-selection);
  color: var(--color-selection-text);
  filter: brightness(1.1);
  cursor: pointer;
}
.segment:has(:disabled) {
  cursor: not-allowed;
  color: var(--color-text-muted);
  background: var(--color-surface-raised);
}
.fill .track {
  display: flex;
}
.fill .segment {
  flex: 1 1 0;
  min-width: 0;
}
.content .track {
  flex-wrap: wrap;
}
.scroll .track {
  display: flex;
  overflow-x: auto;
  scroll-padding: var(--gap-compact);
}
.scroll .segment {
  flex: 0 0 auto;
}
@media (forced-colors: active) {
  .selected {
    outline: 1px solid Highlight;
  }
}
</style>
