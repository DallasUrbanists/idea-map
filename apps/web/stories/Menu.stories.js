import { ref } from 'vue'
import Menu from '../app/components/Menu.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Menu', component: Menu }
const state = () => ({ result: ref('No action selected'), items: ref([{ value: 'preview', label: 'Preview draft' }, { value: 'copy', label: 'Copy draft link' }, { value: 'archive', label: 'Archive unavailable', disabled: true }]) })
export const Default = example({ Menu }, '<div class="catalog-stack"><Menu label="Draft tools" :items="items" @select="result = $event" /><p role="status">Selected: {{ result }}</p></div>', state)
export const Inline = example({ Menu }, '<Menu inline label="Draft tools" :items="items" @select="result = $event" /><p role="status">Selected: {{ result }}</p>', state)
export const Checkboxes = example({ Menu }, '<Menu label="Visible layers" :items="items" @check="(value, checked) => items.find(item => item.value === value).checked = checked" />', () => ({ items: ref([{ value: 'ideas', label: 'Community ideas', checked: true }, { value: 'workshops', label: 'Workshops', checked: false }]) }))
export const Light = { ...Default, globals: { theme: 'light' } }
export const Dark = { ...Default, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageInline = { ...Inline, tags: ['!dev'] }
export const UsageChecks = { ...Checkboxes, tags: ['!dev'] }

