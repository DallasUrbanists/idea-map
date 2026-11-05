import { ref } from 'vue'
import MapControls from '../app/components/MapControls.vue'
import { example } from './catalog-story.js'

export default { title: 'Components/Map controls', component: MapControls }
export const Default = example({ MapControls }, '<div class="catalog-stack catalog-map"><MapControls v-model:zoom="zoom" :following="following" :layers="layers" @recenter="following = !following; result = following ? \'Following your location\' : \'Map follow paused\'" @layer="(value, checked) => layers.find(layer => layer.value === value).checked = checked" @attribution="result = \'Map preview uses synthetic content; no map provider is connected.\'" /><p role="status">{{ result || "Zoom level " + zoom }}</p><p>Community ideas are also available in the list view.</p></div>', () => ({ zoom: ref(12), following: ref(false), result: ref(''), layers: ref([{ value: 'ideas', label: 'Community ideas', checked: true }, { value: 'workshops', label: 'Workshops', checked: false }]) }))
export const ZoomLimit = example({ MapControls }, '<MapControls :zoom="20" following />')
export const Locating = example({ MapControls }, '<MapControls :zoom="12" locating />')
export const LocationError = example({ MapControls }, '<MapControls :zoom="12" error="Location is unavailable. Allow location access or choose a place on the map." />')
export const Light = { ...Default, globals: { theme: 'light' } }
export const Dark = { ...Default, globals: { theme: 'dark' } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageError = { ...LocationError, tags: ['!dev'] }

