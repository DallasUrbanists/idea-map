import IdeaStatus from '../app/components/IdeaStatus.vue'

export default {
  title: 'Components/Status',
  component: IdeaStatus,
  argTypes: { tone: { control: 'select', options: ['info', 'success', 'warning', 'error'] } },
  args: { tone: 'info', message: 'Your draft is visible only to you.' },
  render: (args) => ({ components: { IdeaStatus }, setup: () => ({ args }), template: '<IdeaStatus :tone="args.tone">{{ args.message }}</IdeaStatus>' }),
}
export const Default = {}
export const Success = { args: { tone: 'success', message: 'Your idea was saved.' } }
export const Warning = { args: { tone: 'warning', message: 'Add a location before submitting.' } }
export const Error = { args: { tone: 'error', message: 'We could not save your changes. Try again.' } }
