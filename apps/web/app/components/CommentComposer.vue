<script setup lang="ts">
import Input from './Input.vue'
import Button from './Button.vue'
import Status from './Status.vue'

withDefaults(defineProps<{ modelValue: string; role: 'guest' | 'owner' | 'moderator'; state?: 'idle' | 'pending' | 'error' | 'offline'; error?: string }>(), { state: 'idle', error: '' })
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: [] }>()
</script>
<template>
  <form class="composer" @submit.prevent="role !== 'guest' && state !== 'pending' && state !== 'offline' && modelValue.trim() && emit('submit')">
    <p v-if="role === 'guest'">Sign in to join the discussion.</p>
    <template v-else>
      <Input :model-value="modelValue" label="Your comment" multiline required :error="state === 'error' ? error || 'Your comment could not be sent. Try again.' : ''" @update:model-value="emit('update:modelValue', $event)" />
      <Status v-if="state === 'offline'" tone="warning" live="polite">You are offline. Your text remains here; send it when connected.</Status>
      <Button type="submit" :loading="state === 'pending'" loading-label="Sending…" :disabled="state === 'offline' || !modelValue.trim()">Send comment</Button>
    </template>
  </form>
</template>
<style scoped>.composer { display: grid; gap: var(--gap-standard); justify-items: start; } .composer :deep(.field) { width: 100%; } p { margin: 0; }</style>
