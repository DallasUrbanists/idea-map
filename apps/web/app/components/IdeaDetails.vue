<script setup lang="ts">
import Card from './Card.vue'
import Button from './Button.vue'

defineProps<{ title: string; author: string; description: string; role: 'guest' | 'owner' | 'moderator' }>()
const emit = defineEmits<{ edit: []; moderate: [] }>()
</script>
<template>
  <Card hairline>
    <template #header><h2>{{ title }}</h2><p>Proposed by {{ author }}</p></template>
    <p>{{ description }}</p>
    <template v-if="role !== 'guest'" #footer>
      <Button v-if="role === 'owner'" variant="secondary" @click="emit('edit')">Edit your idea</Button>
      <Button v-if="role === 'moderator'" variant="secondary" @click="emit('moderate')">Review idea</Button>
    </template>
  </Card>
</template>
<style scoped>h2,p { margin: 0; } p { overflow-wrap: anywhere; }</style>
