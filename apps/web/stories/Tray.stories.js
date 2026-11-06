import Tray from '../app/components/Tray.vue'
import TraySpecimen from './TraySpecimen.vue'

export default {
  title: 'Components/Tray', component: Tray, parameters: { layout: 'fullscreen' },
  render: args => ({ components: { TraySpecimen }, setup: () => ({ args }), template: '<TraySpecimen v-bind="args" />' }),
}
export const Default = {}
export const ShortContent = { args: { short: true } }
export const Side = { args: { placement: 'side' } }
export const Busy = { args: { busy: true } }
export const OpeningDisabled = { args: { canDragOpen: false } }
export const ClosingDisabled = { args: { canDragClose: false } }
export const Dark = { globals: { theme: 'dark' } }
