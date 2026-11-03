import IdeaProgress from '../app/components/IdeaProgress.vue'

export default {
  title: 'Components/Progress',
  component: IdeaProgress,
  args: { label: 'Preparing preview', value: 40, max: 100 },
}
export const Default = {}
export const Complete = { args: { value: 100 } }
export const Indeterminate = { args: { value: undefined } }
