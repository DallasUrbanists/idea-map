import MapShell from '../app/components/MapShell.vue'
import MapSpecimen from './MapSpecimen.vue'
import { withMapFixture } from './map-fixture'

export default {
  title: 'Components/Map shell', component: MapShell, parameters: { layout: 'fullscreen' },
  render: args => ({ components: { MapSpecimen }, setup: () => ({ args }), template: '<MapSpecimen v-bind="args" />' }),
}
export const Default = {}
export const Desktop = { args: { presentation: 'desktop', initialView: 'idea' } }
export const App = { args: { presentation: 'app', initialView: 'idea' } }
export const InteractionFixture = { decorators: [withMapFixture] }
