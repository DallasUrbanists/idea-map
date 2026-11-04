import Status from '../app/components/Status.vue'
import { example } from './catalog-story.js'

export default {
  title: 'Components/Status',
  component: Status,
  argTypes: { tone: { control: 'select', options: ['info', 'success', 'warning', 'error'] } },
  args: { tone: 'info', variant: 'text', message: 'Scheduled' },
  render: (args) => ({ components: { Status }, setup: () => ({ args }), template: '<Status :tone="args.tone" :variant="args.variant">{{ args.message }}</Status>' }),
}
export const Default = {}
export const Success = { args: { tone: 'success', message: 'Your idea was saved.' } }
export const Warning = { args: { tone: 'warning', message: 'Add a location before submitting.' } }
export const Error = { args: { tone: 'error', message: 'We could not save your changes. Try again.' } }
export const Pill = example({ Status }, '<div class="catalog-row"><Status variant="pill" tone="success">Saved</Status><Status variant="pill" tone="warning">Needs review</Status><Status variant="pill" tone="error">Update failed</Status><Status variant="pill">Scheduled</Status></div>')
export const Banner = { args: { variant: 'banner', tone: 'info', message: 'Your draft is visible only to you.' } }
export const Light = { ...Pill, globals: { theme: 'light' } }
export const Dark = { ...Pill, globals: { theme: 'dark' } }
export const UsageDefault = { ...example({ Status }, '<div class="catalog-row"><Status variant="text" tone="success">Saved</Status><Status variant="text" tone="warning">Needs review</Status><Status variant="text">Scheduled</Status></div>'), tags: ['!dev'] }
export const UsagePill = { ...Pill, tags: ['!dev'] }
export const UsageBanner = { ...Banner, tags: ['!dev'] }
