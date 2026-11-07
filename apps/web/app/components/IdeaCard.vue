<script setup lang="ts">
import Card from './Card.vue'
import Button from './Button.vue'

withDefaults(defineProps<{ title: string; summary: string; liked?: boolean; following?: boolean; role?: 'guest' | 'owner' | 'moderator'; pending?: boolean; offline?: boolean; error?: string }>(), { role: 'guest' })
const emit = defineEmits<{ open: []; like: []; follow: []; moderate: [] }>()
</script>

<template>
  <Card hairline>
    <template #header><h2>{{ title }}</h2></template>
    <p>{{ summary }}</p>
    <p v-if="role === 'owner'">Your idea</p>
    <p v-if="offline" role="status">Offline: actions are unavailable.</p>
    <p v-if="error" role="status">{{ error }}</p>
    <template #footer>
      <Button variant="transparent" @click="emit('open')">View idea</Button>
      <Button variant="transparent" :aria-pressed="!!liked" :disabled="role === 'guest' || offline" :loading="pending" loading-label="Updating…" @click="emit('like')">Like</Button>
      <Button variant="transparent" :aria-pressed="!!following" :disabled="role === 'guest' || offline" :loading="pending" loading-label="Updating…" @click="emit('follow')">Follow</Button>
      <Button v-if="role === 'moderator'" variant="transparent" @click="emit('moderate')">Review idea</Button>
    </template>
    <p v-if="role === 'guest'">Sign in to like or follow.</p>
  </Card>
</template>

<style scoped>
h2, p { margin: 0; }
p + p { margin-top: var(--gap-compact); }
</style>
