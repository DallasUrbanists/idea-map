import MapSpecimen from './MapSpecimen.vue'
import LayoutSpecimen from './LayoutSpecimen.vue'
import { withMapFixture, withProviderFailure } from './map-fixture'

export default { title: 'Components/Layout patterns', component: MapSpecimen, parameters: { layout: 'fullscreen' }, args: { presentation: 'auto' } }
export const Default = {}
export const Light = { globals: { theme: 'light' } }
export const Dark = { globals: { theme: 'dark' } }
export const Desktop = { args: { presentation: 'desktop', initialView: 'idea' } }
export const Phone = { args: { presentation: 'app', initialView: 'idea' }, globals: { viewport: { value: 'iphone12', isRotated: false } } }
export const ScrollableActions = { name: 'Scrollable pill actions', args: { presentation: 'app', actionItems: [{ value: 'results', label: 'Browse ideas' }, { value: 'saved', label: 'Saved ideas' }, { value: 'new-idea', label: 'New idea' }, { value: 'profile', label: 'Profile' }, { value: 'settings', label: 'Settings' }, { value: 'search', label: 'Search history' }] }, globals: { viewport: { value: 'iphone12', isRotated: false } } }
export const TabletPortrait = { args: { presentation: 'app', initialView: 'idea' }, globals: { viewport: { value: 'ipad', isRotated: false } } }
export const TabletLandscape = { args: { presentation: 'app', initialView: 'idea' }, globals: { viewport: { value: 'ipad', isRotated: true } } }
export const SearchResults = { args: { initialView: 'results' } }
export const NewIdea = { args: { initialView: 'new-idea' } }
export const Profile = { args: { initialView: 'profile' } }
export const Settings = { args: { initialView: 'settings' } }
export const MissingConfiguration = { args: { apiKey: '' } }
export const ProviderFailure = { decorators: [withProviderFailure] }
export const InteractionFixture = { name: 'Interaction fixture (synthetic SDK)', decorators: [withMapFixture] }
export const DocumentLayout = { name: 'Document layout (non-map)', render: () => ({ components: { LayoutSpecimen }, template: '<LayoutSpecimen />' }) }
