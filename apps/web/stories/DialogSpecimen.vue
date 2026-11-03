<script setup lang="ts">
import IdeaButton from '../app/components/IdeaButton.vue'
import IdeaDialog from '../app/components/IdeaDialog.vue'
</script>

<template>
  <main>
    <h1>Dialog</h1>
    <p>Open the dialog to review its focus, layout, and close behavior.</p>
    <IdeaDialog title="Review this idea before continuing" description="Check the details and close this dialog when you are done.">
      <template #trigger><IdeaButton>Open dialog</IdeaButton></template>
      <p>The dialog keeps its content on an opaque surface and returns focus to its trigger when closed.</p>
    </IdeaDialog>
  </main>
</template>

<style scoped>
main { box-sizing: border-box; max-width: 76rem; margin: 0 auto; padding: var(--space-8); }
h1 { margin: 0 0 var(--space-4); font: var(--weight-heavy) var(--font-title) / var(--line-heading) var(--font-family-heading); letter-spacing: -.02em; }
p { max-width: 65ch; margin: 0 0 var(--space-4); }
@media (max-width: 640px) { main { padding: var(--space-4); } }
</style>
