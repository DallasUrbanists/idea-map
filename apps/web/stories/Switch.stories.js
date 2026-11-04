import { ref } from 'vue'
import Switch from '../app/components/Switch.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Switch', component: Switch }
export const Default = example({ Switch }, '<div class="catalog-stack"><Switch v-model="enabled" label="Show community ideas" hint="Changes apply immediately." /><p role="status">{{ enabled ? "Community ideas are visible" : "Community ideas are hidden" }}</p></div>', () => ({ enabled: ref(false) }))
export const On = example({ Switch }, '<Switch v-model="enabled" label="Show saved places" />', () => ({ enabled: ref(true) }))
export const Disabled = example({ Switch }, '<Switch :model-value="true" label="Email updates" disabled hint="Sign in to change email settings." />')
export const LongLabel = example({ Switch }, '<Switch v-model="enabled" label="Show community ideas and upcoming workshops in the selected neighborhood" hint="Long labels wrap while the entire row remains a touch target." />', () => ({ enabled: ref(true) }))
export const Light = { ...On, globals: { theme: 'light' } }
export const Dark = { ...On, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageDisabled = { ...Disabled, tags: ['!dev'] }

