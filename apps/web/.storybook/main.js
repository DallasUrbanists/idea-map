import vue from '@vitejs/plugin-vue'

export default {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.js'],
  addons: ['@storybook/addon-docs'],
  framework: '@storybook/vue3-vite',
  viteFinal: async (config) => ({
    ...config,
    plugins: [...(config.plugins || []), vue()],
  }),
}
