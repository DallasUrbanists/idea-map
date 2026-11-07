<script setup lang="ts">
import Card from './Card.vue'
defineProps<{ summary: string; messages: { id: string; author: string; text: string }[] }>()
</script>
<template>
  <section aria-label="Clarification conversation">
    <h2>Clarification conversation</h2>
    <Card hairline><h3>Summary</h3><p>{{ summary }}</p></Card>
    <ol><li v-for="message in messages" :key="message.id"><strong>{{ message.author }}</strong><p>{{ message.text }}</p></li></ol>
    <p v-if="!messages.length">No clarification messages yet.</p>
    <slot />
  </section>
</template>
<style scoped>h3, p { margin: 0; } ol { padding-inline-start: 1.5rem; } li { margin-block: var(--gap-standard); overflow-wrap: anywhere; }</style>
