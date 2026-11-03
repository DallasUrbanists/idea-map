import '@fontsource-variable/figtree'
import { addons } from 'storybook/preview-api'
import { GLOBALS_UPDATED, SET_GLOBALS } from 'storybook/internal/core-events'
import '../src/styles/tokens.css'
import './preview.css'
import './docs-theme.css'

// Unattached MDX docs do not run story decorators, so follow preview globals too.
const themeChannel = addons.getChannel()
const applyTheme = ({ globals }) => {
  document.documentElement.dataset.theme = globals?.theme || 'system'
}
themeChannel.on(SET_GLOBALS, applyTheme)
themeChannel.on(GLOBALS_UPDATED, applyTheme)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    themeChannel.off(SET_GLOBALS, applyTheme)
    themeChannel.off(GLOBALS_UPDATED, applyTheme)
  })
}

export const parameters = {
  options: {
    storySort: { order: ['Foundations', ['Principles', 'Tokens', 'Color', 'Typography', 'Size and space', 'Containers', 'Theming'], 'Components'] },
  },
}

export const globalTypes = {
  theme: {
    description: 'Color theme for the component preview',
    toolbar: { title: 'Theme', icon: 'paintbrush', items: ['system', 'light', 'dark'], dynamicTitle: true },
  },
}

export const initialGlobals = { theme: 'system' }

export const decorators = [
  (story, context) => {
    document.documentElement.dataset.theme = context.globals.theme
    return story()
  },
]
