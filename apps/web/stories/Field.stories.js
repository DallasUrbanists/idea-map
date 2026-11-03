import IdeaField from '../app/components/IdeaField.vue'

export default {
  title: 'Components/Field',
  component: IdeaField,
  args: { label: 'Idea title', modelValue: '', hint: 'Use a short, descriptive title.' },
  render: (args) => ({ components: { IdeaField }, setup: () => ({ args }), template: '<IdeaField v-bind="args" @update:model-value="args.modelValue = $event" />' }),
}
export const Default = {}
export const Error = { args: { error: 'Enter a title.', required: true } }
export const Multiline = { args: { label: 'Description', multiline: true } }
export const Disabled = { args: { disabled: true } }
