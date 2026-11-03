import IdeaSelect from '../app/components/IdeaSelect.vue'

export default {
  title: 'Components/Select',
  component: IdeaSelect,
  args: { label: 'Category', modelValue: '', options: [{ value: '', label: 'Choose a category' }, { value: 'walking', label: 'Walking and rolling' }, { value: 'transit', label: 'Public transit' }] },
  render: (args) => ({ components: { IdeaSelect }, setup: () => ({ args }), template: '<IdeaSelect v-bind="args" @update:model-value="args.modelValue = $event" />' }),
}
export const Default = {}
export const Error = { args: { error: 'Choose a category.', required: true } }
export const Disabled = { args: { disabled: true } }
