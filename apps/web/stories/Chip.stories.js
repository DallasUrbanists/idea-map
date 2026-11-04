import Chip from '../app/components/Chip.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Chip', component: Chip }
export const Default = example({ Chip }, '<div class="catalog-row"><Chip>Workshop</Chip><Chip variant="muted">Community idea</Chip><Chip variant="accent">Update</Chip><Chip variant="solid">Release</Chip><Chip variant="inverse">API</Chip><Chip variant="outline">Web</Chip></div>')
export const Meaning = example({ Chip }, '<div class="catalog-row"><Chip variant="good">Saved</Chip><Chip variant="warn">Needs review</Chip><Chip variant="alert">Update failed</Chip><Chip variant="critical">Service unavailable</Chip><Chip variant="highlight">New</Chip></div>')
export const Compact = example({ Chip }, '<div class="catalog-row"><Chip small variant="solid">v1.4</Chip><Chip small mono variant="muted">a1b2c3</Chip></div>')
export const Light = { ...Meaning, globals: { theme: 'light' } }
export const Dark = { ...Meaning, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageMeaning = { ...Meaning, tags: ['!dev'] }
export const UsageCompact = { ...Compact, tags: ['!dev'] }

