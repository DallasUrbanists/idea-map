import Badge from '../app/components/Badge.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Badge', component: Badge }
export const Default = example({ Badge }, '<Badge>Draft</Badge>')
export const WithIcon = example({ Badge }, '<Badge><template #icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a8 8 0 1 0 3-6M4 3v5h5" /></svg></template>Review in progress</Badge>')
export const LongLabel = example({ Badge }, '<Badge>Community workshop draft awaiting review</Badge>')
export const Light = { ...WithIcon, globals: { theme: 'light' } }
export const Dark = { ...WithIcon, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageIcon = { ...WithIcon, tags: ['!dev'] }

