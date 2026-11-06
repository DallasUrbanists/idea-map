import Button from '../app/components/Button.vue'
import AnimatedIcon from '../app/components/AnimatedIcon.vue'
import './button-stories.css'

const examples = [
  { name: 'Primary', variant: 'primary' },
  { name: 'Secondary', variant: 'secondary' },
  { name: 'Badge', variant: 'badge' },
  { name: 'Warning', variant: 'warning' },
  { name: 'Transparent', variant: 'transparent' },
  { name: 'Loading', variant: 'primary', loading: true },
  { name: 'Disabled', variant: 'primary', disabled: true },
]

const renderExamples = (content) => () => ({
  components: { Button, AnimatedIcon },
  setup: () => ({ examples, content }),
  template: `
    <div class="button-story-themes">
      <section v-for="theme in ['light', 'dark']" :key="theme" :class="['button-story-card', 'button-story-' + theme]" :aria-label="theme === 'light' ? 'Light theme' : 'Dark theme'">
        <h2>{{ theme === 'light' ? 'Light' : 'Dark' }}</h2>
        <div class="button-story-examples">
      <div v-for="example in examples" :key="example.name" class="button-story-example">
        <span>{{ example.name }}</span>
        <Button :variant="example.variant" :loading="example.loading" :disabled="example.disabled" :icon-only="content === 'icon'"
          :aria-label="content === 'icon' ? (example.loading ? 'Saving idea' : example.name + ' save idea') : undefined">
          <template v-if="content !== 'text'" #icon><AnimatedIcon name="saved" /></template>
          <span v-if="content !== 'icon'">{{ content === 'both' ? ' Save idea' : 'Save idea' }}</span>
          <template #loading>
            <AnimatedIcon v-if="content !== 'text'" name="spinner" />
            <span v-if="content !== 'icon'" :class="{ 'button-story-loading-after-icon': content === 'both' }">
              <span class="button-story-visually-hidden">Saving…</span>
              <span aria-hidden="true"><span v-for="(letter, index) in Array.from('Saving…')" :key="index" class="button-story-loading-letter" :style="{ animationDelay: (index * 0.1) + 's' }">{{ letter }}</span></span>
            </span>
          </template>
        </Button>
      </div>
        </div>
      </section>
    </div>`,
})

export default {
  title: 'Components/Button',
  component: Button,
  parameters: { controls: { disable: true } },
}

export const TextOnly = { name: 'Text only', render: renderExamples('text') }
export const IconOnly = { name: 'Icon only', render: renderExamples('icon') }
export const IconAndText = { name: 'Icon and text', render: renderExamples('both') }

const usageExample = (template) => ({
  render: () => ({ components: { Button }, template }),
})

export const UsagePrimary = { ...usageExample('<Button>Save idea</Button>'), tags: ['!dev'] }
export const UsageSecondary = { ...usageExample('<Button variant="secondary">Preview</Button>'), tags: ['!dev'] }
export const UsageBadge = { ...usageExample('<Button variant="badge">Browse ideas</Button>'), tags: ['!dev'] }
export const UsageWarning = { ...usageExample('<Button variant="warning">Review before continuing</Button>'), tags: ['!dev'] }
export const UsageTransparent = { ...usageExample('<Button variant="transparent">Show details</Button>'), tags: ['!dev'] }
export const UsageIcon = { ...usageExample('<Button icon-only aria-label="Add idea"><template #icon><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg></template></Button>'), tags: ['!dev'] }
export const UsageStates = { ...usageExample('<div style="display:flex;flex-wrap:wrap;gap:var(--gap-compact)"><Button loading loading-label="Saving idea…">Save idea</Button><Button disabled>Submit unavailable</Button></div>'), tags: ['!dev'] }
