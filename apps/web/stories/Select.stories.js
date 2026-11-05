import Select from '../app/components/Select.vue'

export default {
  title: 'Components/Select',
  component: Select,
  args: { label: 'Category', modelValue: '', options: [{ value: '', label: 'Choose a category' }, { value: 'walking', label: 'Walking and rolling' }, { value: 'transit', label: 'Public transit' }] },
  render: (args) => ({ components: { Select }, setup: () => ({ args }), template: '<Select v-bind="args" @update:model-value="args.modelValue = $event" />' }),
}
export const Default = {}
export const Error = { args: { error: 'Choose a category.', required: true } }
export const Disabled = { args: { disabled: true } }
export const UsageDefault = { ...Default, tags: ['!dev'] }
export const UsageError = { ...Error, tags: ['!dev'] }
export const UsageDisabled = { ...Disabled, tags: ['!dev'] }
