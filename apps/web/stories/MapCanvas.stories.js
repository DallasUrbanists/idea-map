import MapCanvas from '../app/components/MapCanvas.vue'
import { withMapFixture, withProviderFailure } from './map-fixture'

export default {
  title: 'Components/Map canvas', component: MapCanvas, parameters: { layout: 'fullscreen' },
  args: { apiKey: import.meta.env.STORYBOOK_GOOGLE_MAPS_API_KEY || '', mapId: import.meta.env.STORYBOOK_GOOGLE_MAPS_MAP_ID || '', markers: [{ id: 'crossing', title: 'Synthetic library crossing', position: { lat: 32.7769, lng: -96.7973 } }] },
  render: args => ({ components: { MapCanvas }, setup: () => ({ args }), template: '<div style="height:100dvh;position:relative"><MapCanvas v-bind="args" /></div>' }),
}
export const Default = {}
export const MissingConfiguration = { args: { apiKey: '' } }
export const ProviderFailure = { decorators: [withProviderFailure] }
export const InteractionFixture = { decorators: [withMapFixture] }
