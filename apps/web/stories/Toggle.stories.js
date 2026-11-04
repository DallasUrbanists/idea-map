import Toggle from '../app/components/Toggle.vue'

export default {
  title: 'Components/Toggle',
  component: Toggle,
  args: { label: 'Receive idea updates', modelValue: false },
  render: (args) => ({ components: { Toggle }, setup: () => ({ args }), template: '<Toggle v-bind="args" @update:model-value="args.modelValue = $event" />' }),
}
export const Default = {}
export const On = { args: { modelValue: true } }
export const Disabled = { args: { disabled: true } }
