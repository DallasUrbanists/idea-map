import { ref } from 'vue'
import Toast from '../app/components/Toast.vue'
import Button from '../app/components/Button.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Toast', component: Toast }
const demo = (tone = 'success', action = false) => example({ Toast, Button }, '<div class="catalog-stack"><Button @click="open = true">Show notification</Button><p role="status">{{ result }}</p><Toast v-model:open="open" inline :tone="tone" title="Idea saved" description="Your draft is available in saved ideas." :action-label="action ? \'Undo\' : undefined" @action="result = \'Save undone\'" /></div>', () => ({ open: ref(false), result: ref(''), tone, action }))
export const Default = demo()
export const WithAction = demo('neutral', true)
export const Error = example({ Toast }, '<Toast :open="true" inline title="Could not save changes" description="Your draft is still available. Try saving again." tone="error" :duration="Infinity" />')
export const Tones = example({ Toast }, '<div class="catalog-stack"><Toast v-for="tone in [\'neutral\', \'success\', \'warning\', \'error\', \'info\', \'loading\']" :key="tone" :open="true" inline :tone="tone" :title="labels[tone]" :duration="Infinity" /></div>', () => ({ labels: { neutral: 'Draft updated', success: 'Idea saved', warning: 'Connection is slow', error: 'Save failed', info: 'Workshop starts tomorrow', loading: 'Saving your idea…' } }))
export const Pill = example({ Toast }, '<Toast :open="true" inline pill title="Draft saved" :duration="Infinity" />')
export const Light = { ...Tones, globals: { theme: 'light' } }
export const Dark = { ...Tones, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageAction = { ...WithAction, tags: ['!dev'] }
export const UsagePill = { ...Pill, tags: ['!dev'] }

