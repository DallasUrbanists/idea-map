<script setup lang="ts">
import { ref } from 'vue'
import Button from '../app/components/Button.vue'
import Dialog from '../app/components/Dialog.vue'
import Menu from '../app/components/Menu.vue'
import NavigationRail from '../app/components/NavigationRail.vue'
import PageLayout from '../app/components/PageLayout.vue'
import Toast from '../app/components/Toast.vue'
const toastOpen = ref(false)
const result = ref('No action selected')
const items = [{ value: 'nearby', label: 'Nearby', href: '#nearby' }, { value: 'saved', label: 'Saved', href: '#saved' }]
const actions = [{ value: 'copy', label: 'Copy link' }, { value: 'share', label: 'Share idea' }]
</script>

<template>
  <PageLayout>
    <template #header><strong>Community ideas</strong></template>
    <template #navigation><NavigationRail current="nearby" :items="items" /></template>
    <h1>Explore your neighborhood</h1>
    <p>Review an idea or open the tools menu.</p>
    <div class="actions">
      <Dialog title="Review idea" description="Check the details before continuing.">
        <template #trigger><Button>Open dialog</Button></template>
        <p>A safer crossing near the community library.</p>
      </Dialog>
      <Dialog placement="tray" title="Idea details" description="Explore the details in this tray.">
        <template #trigger><Button variant="secondary">Open tray</Button></template>
        <p>A shaded place to wait for the bus.</p>
        <Button @click="toastOpen = true">Save idea</Button>
      </Dialog>
      <Menu label="Idea tools" :items="actions" @select="result = $event" />
      <Button variant="secondary" @click="toastOpen = true">Show notification</Button>
    </div>
    <p role="status">{{ result }}</p>
    <Toast v-model:open="toastOpen" title="Idea saved" description="Your draft is available in saved ideas." tone="success" :duration="Infinity" />
    <template #aside><h2>Nearby</h2><p>Ideas shared by your neighbors appear here.</p></template>
  </PageLayout>
</template>

<style scoped>
h1 { font: var(--weight-heavy) var(--font-title) / var(--line-heading) var(--font-family-heading); }
.actions { display: flex; flex-wrap: wrap; gap: var(--gap-compact); }
</style>
