import Spinner from '../app/components/Spinner.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Spinner', component: Spinner }
export const Default = example({ Spinner }, '<Spinner label="Saving your idea…" />')
export const Light = { ...Default, globals: { theme: 'light' } }
export const Dark = { ...Default, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }

