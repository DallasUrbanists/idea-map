import IdeaToggle from '../app/components/IdeaToggle.vue'

export default {
  title: 'Components/Toggle',
  component: IdeaToggle,
  args: { label: 'Receive idea updates', modelValue: false },
  render: (args) => ({ components: { IdeaToggle }, setup: () => ({ args }), template: '<IdeaToggle v-bind="args" @update:model-value="args.modelValue = $event" />' }),
}
export const Default = {}
export const On = { args: { modelValue: true } }
export const Disabled = { args: { disabled: true } }
