import DialogSpecimen from './DialogSpecimen.vue'
import IdeaDialog from '../app/components/IdeaDialog.vue'

export default { title: 'Components/Dialog', component: IdeaDialog, parameters: { layout: 'fullscreen' }, render: () => ({ components: { DialogSpecimen }, template: '<DialogSpecimen />' }) }

export const Default = {}
