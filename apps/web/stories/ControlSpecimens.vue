<script setup lang="ts">
import { nextTick, ref } from 'vue'
import IdeaButton from '../app/components/IdeaButton.vue'
import IdeaField from '../app/components/IdeaField.vue'
import IdeaSelect from '../app/components/IdeaSelect.vue'
import IdeaToggle from '../app/components/IdeaToggle.vue'
import IdeaStatus from '../app/components/IdeaStatus.vue'
import IdeaProgress from '../app/components/IdeaProgress.vue'

withDefaults(defineProps<{ section?: 'all' | 'buttons' | 'fields' | 'toggles' | 'status' | 'progress' | 'form' }>(), { section: 'all' })
const title = ref('A shaded walk to the library')
const description = ref('Add street trees and places to rest along the neighborhood walking route.')
const category = ref('walking')
const updates = ref(true)
const clicks = ref(0)
const formTitle = ref('')
const error = ref('')
const phase = ref<'idle' | 'saving' | 'failed' | 'saved'>('idle')
const form = ref<HTMLFormElement>()
const options = [{ value: '', label: 'Choose a category' }, { value: 'walking', label: 'Walking and rolling' }, { value: 'transit', label: 'Public transit' }, { value: 'closed', label: 'Other (unavailable)', disabled: true }]
async function save() {
  if (phase.value === 'saving') return
  error.value = formTitle.value.trim() ? '' : 'Enter a short title for your idea.'
  if (error.value) {
    await nextTick()
    form.value?.querySelector('input')?.focus()
    return
  }
  phase.value = 'saving'
}
</script>

<template>
  <main class="specimens">
    <header><p class="eyebrow">IDEA MAP / COMPONENT LIBRARY</p><h1>Controls for everyday ideas</h1><p>Shared controls, clear feedback, and room for real content.</p></header>
    <div class="grid">
      <section v-if="section === 'all' || section === 'buttons'">
        <h2>Buttons</h2><p>One primary action. Neutral alternatives. Explicit destructive labels.</p>
        <div class="actions"><IdeaButton @click="clicks++">Save idea</IdeaButton><IdeaButton variant="secondary">Preview</IdeaButton><IdeaButton variant="danger">Delete draft</IdeaButton></div>
        <div class="actions"><IdeaButton disabled>Save unavailable</IdeaButton><IdeaButton loading loading-label="Saving idea…">Save idea</IdeaButton></div>
        <p class="caption" role="status">Save activations: {{ clicks }}. Loading blocks repeat activation while retaining focus.</p>
      </section>
      <section v-if="section === 'all' || section === 'fields'" class="fields">
        <h2>Fields &amp; validation</h2><p>Persistent labels and guidance stay beside the control.</p>
        <IdeaField v-model="title" label="Idea title" required hint="Use a short, descriptive title." name="title" />
        <IdeaField v-model="description" label="What would improve this place?" multiline />
        <IdeaSelect v-model="category" label="Category" :options="options" />
        <IdeaField model-value="" label="Neighborhood" error="Enter a neighborhood to continue." hint="Use a neighborhood name, not a home address." />
        <IdeaField model-value="Public after review" label="Visibility (unavailable)" disabled hint="Visibility is managed during review." />
        <IdeaSelect model-value="" label="Category needing attention" :options="options" required error="Choose a category." />
        <IdeaSelect model-value="walking" label="Saved category (unavailable)" :options="options" disabled />
      </section>
      <section v-if="section === 'all' || section === 'toggles'">
        <h2>Toggles</h2><p>Space changes the setting. The label stays the same in either state.</p>
        <IdeaToggle v-model="updates" label="Receive idea updates" hint="Get updates when this idea moves to the next stage." name="updates" />
        <IdeaToggle :model-value="false" label="Weekly digest (unavailable)" disabled hint="Available after email verification." />
        <IdeaToggle :model-value="true" label="Review notifications (required)" disabled />
      </section>
      <section v-if="section === 'all' || section === 'status'">
        <h2>Status &amp; recovery</h2><p>Words and symbols carry meaning alongside color.</p>
        <IdeaStatus>Your draft is visible only to you.</IdeaStatus>
        <IdeaStatus tone="success">Your idea was saved.</IdeaStatus>
        <IdeaStatus tone="warning">Add a location before submitting.</IdeaStatus>
        <IdeaStatus tone="error">We could not save your changes. Your text is still here; try again.</IdeaStatus>
      </section>
      <section v-if="section === 'all' || section === 'progress'">
        <h2>Progress</h2><p>Known progress uses a value. Unknown duration stays indeterminate.</p>
        <IdeaProgress label="Preparing preview" :value="40" hint="2 of 5 images prepared." />
        <IdeaProgress label="Waiting to start" :value="0" />
        <IdeaProgress label="Preview ready" :value="100" />
        <IdeaProgress label="Checking the upload" hint="This may take a moment. You can keep reading." />
      </section>
      <section v-if="section === 'all' || section === 'form'">
        <h2>Try a draft</h2><p>A synthetic form: validate, save, simulate a failure, then retry.</p>
        <form ref="form" novalidate @submit.prevent="save">
          <IdeaField v-model="formTitle" label="Draft title" required :error="error" :disabled="phase === 'saving'" hint="No information leaves this specimen." />
          <div aria-live="polite" aria-atomic="true"><IdeaStatus v-if="phase === 'failed'" tone="error">Save failed. Your draft is preserved. Try again.</IdeaStatus><IdeaStatus v-if="phase === 'saved'" tone="success">Draft saved in this example.</IdeaStatus></div>
          <IdeaButton type="submit" :loading="phase === 'saving'">{{ phase === 'failed' ? 'Try again' : 'Save draft' }}</IdeaButton>
        </form>
        <div v-if="phase === 'saving'" class="simulation"><p class="caption">Specimen controls — choose a synthetic response:</p><div class="actions"><IdeaButton variant="secondary" @click="phase = 'failed'">Simulate failure</IdeaButton><IdeaButton variant="secondary" @click="phase = 'saved'">Simulate success</IdeaButton></div></div>
      </section>
    </div>
    <footer>Keyboard: Tab to move · Space to toggle · Enter to submit. Synthetic examples only.</footer>
  </main>
</template>

<style scoped>
.specimens { box-sizing: border-box; max-width: 76rem; margin: 0 auto; padding: var(--space-8); color: var(--color-text); font: var(--font-body) / var(--line-body) var(--font-family-body); text-wrap: pretty; }
header { max-width: 45rem; margin-bottom: var(--space-8); }
h1, h2 { font-family: var(--font-family-heading); font-weight: 700; line-height: var(--line-heading); }
h1 { font-size: var(--font-title); font-weight: var(--weight-heavy); letter-spacing: -.02em; margin: var(--space-2) 0 var(--space-4); }
h2 { font-size: var(--font-heading); margin: 0; }
p { margin: 0; }
.eyebrow, .caption, footer { font-size: var(--font-small); color: var(--color-text-muted); }
.eyebrow { font-family: var(--font-family-heading); letter-spacing: 0.08em; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); align-items: start; }
section { display: grid; gap: var(--space-4); min-width: 0; padding: var(--space-6); border-radius: var(--radius-medium); background: var(--color-surface); }
.fields { grid-row: span 3; }
section > p { color: var(--color-text-muted); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: start; }
form, .simulation { display: grid; gap: var(--space-4); }
form > button { justify-self: start; }
footer { margin-top: var(--space-8); }
@media (max-width: 640px) { .specimens { padding: var(--space-4); } .grid { grid-template-columns: minmax(0, 1fr); } .fields { grid-row: auto; } section { padding: var(--space-4); } }
</style>
