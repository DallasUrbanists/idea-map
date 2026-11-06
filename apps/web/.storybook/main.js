import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'

export default {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.js'],
  addons: ['@storybook/addon-docs'],
  framework: '@storybook/vue3-vite',
  features: { viewport: true },
  viteFinal: async (config, { configType }) => {
    // The documented Storybook scripts execute in the web workspace.
    const root = '../..'
    const environment = loadEnv(configType === 'DEVELOPMENT' ? 'development' : 'production', root, 'STORYBOOK_GOOGLE_MAPS_')
    const live = process.env.STORYBOOK_MAPS_TEST_MODE !== '1' && (configType === 'DEVELOPMENT' || process.env.STORYBOOK_PUBLISH_LIVE_MAPS === 'true')
    const publicMaps = Object.fromEntries(['API_KEY', 'MAP_ID'].map(suffix => {
      const name = `STORYBOOK_GOOGLE_MAPS_${suffix}`
      return [`import.meta.env.${name}`, JSON.stringify(live ? (process.env[name] || environment[name] || '') : '')]
    }))
    const cacheDir = process.env.STORYBOOK_MAPS_TEST_MODE === '1' ? `${config.cacheDir || 'node_modules/.cache/storybook-vite'}-tests` : config.cacheDir
    return { ...config, cacheDir, plugins: [...(config.plugins || []), vue()], define: { ...config.define, ...publicMaps } }
  },
}
