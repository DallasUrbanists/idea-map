<script setup lang="ts">
const route = useRoute()
const { data: idea, error } = await useFetch<{ title: string; description: string }>(
  () => '/api/ideas/' + encodeURIComponent(String(route.params.id)),
)
if (error.value || !idea.value) {
  const statusCode = error.value?.statusCode || 404
  throw createError({ statusCode, statusMessage: statusCode === 404 ? 'Idea not found' : 'Unable to load idea' })
}
useSeoMeta({ title: () => idea.value?.title, description: () => idea.value?.description,
  ogTitle: () => idea.value?.title, ogDescription: () => idea.value?.description })
</script>

<template>
  <main v-if="idea">
    <h1>{{ idea.title }}</h1>
    <p>{{ idea.description }}</p>
  </main>
</template>
