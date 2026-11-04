import { ref } from 'vue'
import NavigationRail from '../app/components/NavigationRail.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Navigation rail', component: NavigationRail }
const state = () => ({ current: ref('nearby'), items: [{ value: 'nearby', label: 'Nearby', href: '#nearby' }, { value: 'saved', label: 'Saved', href: '#saved' }, { value: 'settings', label: 'Settings', href: '#settings' }, { value: 'search', label: 'Search', href: '#search' }], paths: { nearby: 'm3 10 9-7 9 7v11H3Z', saved: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z', settings: 'M4 7h16M4 17h16M8 3v8M16 13v8', search: 'M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0' } })
const template = (capsule) => '<div class="catalog-stack"><NavigationRail :capsule="' + capsule + '" :current="current" :items="items" @click="current = $event.target.closest(\'a\')?.hash.slice(1) || current"><template #icon="{ item }"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path :d="paths[item.value]" /></svg></template></NavigationRail><p :id="current" role="status">Current page: {{ current }}</p></div>'
export const Default = example({ NavigationRail }, template(false), state)
export const Capsule = example({ NavigationRail }, template(true), state)
export const Light = { ...Default, globals: { theme: 'light' } }
export const Dark = { ...Default, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageCapsule = { ...Capsule, tags: ['!dev'] }

