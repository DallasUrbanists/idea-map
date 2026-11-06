import Badge from '../app/components/Badge.vue'
import AnimatedIcon from '../app/components/AnimatedIcon.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Badge', component: Badge }
export const Default = example({ Badge }, '<Badge>Draft</Badge>')
export const WithIcon = example({ Badge, AnimatedIcon }, '<Badge><template #icon><AnimatedIcon name="history" /></template>Review in progress</Badge>')
export const LongLabel = example({ Badge }, '<Badge>Community workshop draft awaiting review</Badge>')
export const Light = { ...WithIcon, globals: { theme: 'light' } }
export const Dark = { ...WithIcon, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageIcon = { ...WithIcon, tags: ['!dev'] }

