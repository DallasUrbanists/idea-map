import IdeaButton from '../app/components/IdeaButton.vue'

export default {
  title: 'Components/Button',
  component: IdeaButton,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'danger'] },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
  args: { variant: 'primary', disabled: false, loading: false, label: 'Save idea' },
  render: (args) => ({ components: { IdeaButton }, setup: () => ({ args }), template: '<IdeaButton v-bind="args">{{ args.label }}</IdeaButton>' }),
}
export const Default = {}
export const Secondary = { args: { variant: 'secondary', label: 'Preview' } }
export const Danger = { args: { variant: 'danger', label: 'Delete draft' } }
export const Loading = { args: { loading: true } }
export const Disabled = { args: { disabled: true } }
