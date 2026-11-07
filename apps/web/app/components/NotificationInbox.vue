<script setup lang="ts">
import Button from './Button.vue'
import Status from './Status.vue'
withDefaults(defineProps<{ items: { id: string; text: string; unread: boolean }[]; state?: 'idle' | 'pending' | 'error' | 'offline' }>(), { state: 'idle' })
const emit = defineEmits<{ open: [id: string]; retry: [] }>()
</script>
<template>
  <section aria-label="Notifications">
    <h2>Notifications</h2>
    <Status v-if="state === 'pending'" live="polite">Loading notifications…</Status>
    <Status v-if="state === 'offline'" tone="warning" live="polite">Offline: showing available notifications.</Status>
    <Status v-if="state === 'error'" tone="error" live="polite">Notifications could not be updated. <Button variant="transparent" @click="emit('retry')">Try again</Button></Status>
    <p v-if="!items.length && state === 'idle'">No notifications yet.</p>
    <ul v-if="items.length">
      <li v-for="item in items" :key="item.id"><Button variant="transparent" @click="emit('open', item.id)">{{ item.unread ? 'Unread: ' : '' }}{{ item.text }}</Button></li>
    </ul>
  </section>
</template>
<style scoped>ul { list-style: none; padding: 0; } li { border-block-end: 1px solid var(--color-border-soft); } li :deep(button) { text-align: start; white-space: normal; }</style>
