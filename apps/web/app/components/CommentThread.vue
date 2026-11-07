<script setup lang="ts">
import Button from './Button.vue'
defineProps<{ comments: { id: string; author: string; text: string; time: string }[]; role: 'guest' | 'owner' | 'moderator' }>()
const emit = defineEmits<{ moderate: [id: string] }>()
</script>
<template>
  <section aria-label="Discussion">
    <h2>Discussion</h2>
    <p v-if="!comments.length">No comments yet.</p>
    <ol v-else>
      <li v-for="comment in comments" :key="comment.id">
        <p><strong>{{ comment.author }}</strong> <span>{{ comment.time }}</span></p>
        <p>{{ comment.text }}</p>
        <Button v-if="role === 'moderator'" variant="transparent" :aria-label="`Review comment by ${comment.author}`" @click="emit('moderate', comment.id)">Review comment</Button>
      </li>
    </ol>
  </section>
</template>
<style scoped>ol { padding: 0; list-style: none; display: grid; gap: var(--gap-standard); } li { border-block-end: 1px solid var(--color-border-soft); padding-block-end: var(--gap-standard); overflow-wrap: anywhere; } p { margin: var(--gap-compact) 0; }</style>
