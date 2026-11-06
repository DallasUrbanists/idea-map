import { ref } from 'vue'
import MapSearchBar from '../app/components/MapSearchBar.vue'
const destinations = [{ value: 'map', label: 'Explore' }, { value: 'search', label: 'Search' }, { value: 'new-idea', label: 'New idea' }, { value: 'saved', label: 'Saved ideas' }, { value: 'profile', label: 'Profile' }, { value: 'settings', label: 'Settings' }]
export default {
  title: 'Components/Map search bar', component: MapSearchBar,
  args: { foregroundOpen: false, canGoBack: false, destinations },
  render: args => ({ components: { MapSearchBar }, setup() { return { args, query: ref(''), action: ref('No action selected') } }, template: '<div style="max-width: 440px"><MapSearchBar v-bind="args" v-model="query" @history="action = \'History\'" @search="action = \'Search\'" @back="action = \'Back\'" @close="action = \'Close\'" @navigate="action = $event" /><p role="status">{{ action }}</p></div>' }),
}
export const Default = {}
export const ForegroundOpen = { args: { foregroundOpen: true, canGoBack: true } }
