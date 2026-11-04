import { ref } from 'vue'
import Input from '../app/components/Input.vue'
import Button from '../app/components/Button.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Input', component: Input }
const state = () => ({ value: ref(''), error: ref('') })
export const Default = example({ Input }, '<div class="catalog-stack"><Input v-model="value" label="Idea title" hint="Describe the improvement briefly." placeholder="A shaded bus stop" name="title" /></div>', state)
export const Search = example({ Input }, '<div class="catalog-stack"><Input v-model="value" type="search" label="Search ideas" placeholder="Search by title or place" /><p class="catalog-result">Search query: {{ value || "All ideas" }}</p></div>', state)
export const Error = example({ Input, Button }, '<form class="catalog-stack" novalidate @submit.prevent="error = value.trim() ? \'\' : \'Enter an idea title.\'"><Input v-model="value" label="Idea title" required :error="error" hint="Your title stays available after a failed save." /><Button type="submit">Check title</Button><p v-if="value.trim() && !error" role="status">Ready to check</p></form>', () => ({ value: ref(''), error: ref('Enter an idea title.') }))
export const Disabled = example({ Input }, '<div class="catalog-stack"><Input model-value="Workshop closed" label="Idea title" disabled hint="Editing is unavailable after the workshop closes." /></div>')
export const Multiline = example({ Input }, '<div class="catalog-stack"><Input v-model="value" label="Description" multiline hint="Explain who the change helps." /></div>', state)
export const Light = { ...Default, globals: { theme: 'light' } }
export const Dark = { ...Default, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageSearch = { ...Search, tags: ['!dev'] }
export const UsageError = { ...Error, tags: ['!dev'] }
export const UsageDisabled = { ...Disabled, tags: ['!dev'] }
export const UsageMultiline = { ...Multiline, tags: ['!dev'] }

