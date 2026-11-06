import { ref } from 'vue'
import NavigationRail from '../app/components/NavigationRail.vue'
import AnimatedIcon from '../app/components/AnimatedIcon.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Navigation rail', component: NavigationRail }
const state = () => ({ current: ref('nearby'), items: [{ value: 'nearby', label: 'Nearby', href: '#nearby' }, { value: 'saved', label: 'Saved', href: '#saved' }, { value: 'settings', label: 'Settings', href: '#settings' }, { value: 'search', label: 'Search', href: '#search' }], icons: { nearby: 'home', saved: 'saved', settings: 'settings', search: 'search' } })
const template = (capsule) => '<div class="catalog-stack"><NavigationRail :capsule="' + capsule + '" :current="current" :items="items" @click="current = $event.target.closest(\'a\')?.hash.slice(1) || current"><template #icon="{ item }"><AnimatedIcon :name="icons[item.value]" /></template></NavigationRail><p :id="current" role="status">Current page: {{ current }}</p></div>'
export const Default = example({ NavigationRail, AnimatedIcon }, template(false), state)
export const Capsule = example({ NavigationRail, AnimatedIcon }, template(true), state)
export const Light = { ...Default, globals: { theme: 'light' } }
export const Dark = { ...Default, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageCapsule = { ...Capsule, tags: ['!dev'] }

