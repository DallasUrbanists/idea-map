import Tooltip from '../app/components/Tooltip.vue'
import Button from '../app/components/Button.vue'
import './button-stories.css'

export default {
  title: 'Components/Tooltip',
  component: Tooltip,
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { Tooltip, Button },
    setup: () => ({ corners: ['Top left', 'Top right', 'Bottom left', 'Bottom right'] }),
    template: `<div class="tooltip-story-corners"><div v-for="corner in corners" :key="corner" class="tooltip-story-corner"><Tooltip :label="corner === 'Top right' ? 'Warning: review before continuing' : 'Tooltip near ' + corner.toLowerCase()" :variant="corner === 'Top right' ? 'warning' : 'default'"><Button :variant="corner === 'Top right' ? 'warning' : 'secondary'">{{ corner }}</Button></Tooltip></div></div>`,
  }),
}
export const Light = { globals: { theme: 'light' } }
export const Dark = { globals: { theme: 'dark' } }

const usageExample = (variant, label, buttonLabel) => ({
  parameters: { layout: 'padded' },
  render: () => ({
    components: { Tooltip, Button },
    setup: () => ({ variant, label, buttonLabel }),
    template: '<div style="padding: var(--gap-spread)"><Tooltip :label="label" :variant="variant"><Button :variant="variant === \'warning\' ? \'warning\' : \'secondary\'">{{ buttonLabel }}</Button></Tooltip></div>',
  }),
})

export const UsageDefault = { ...usageExample('default', 'Opens a preview of your draft', 'Preview'), tags: ['!dev'] }
export const UsageWarning = { ...usageExample('warning', 'Warning: review before continuing', 'Review'), tags: ['!dev'] }
export const UsageLongText = { ...usageExample('default', 'Preview your draft before sharing it. You can check the title, location, and description, then return to editing if anything needs to change.', 'About preview'), tags: ['!dev'] }
export const UsageClipping = {
  tags: ['!dev'],
  parameters: { layout: 'padded' },
  render: () => ({
    components: { Tooltip, Button },
    template: '<div class="tooltip-story-clip"><Tooltip label="This hint can extend outside the clipped container"><Button variant="secondary">Show hint</Button></Tooltip></div>',
  }),
}
