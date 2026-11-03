import vue from '@vitejs/plugin-vue'

export default {
  stories: ['../stories/**/*.stories.js'],
  framework: '@storybook/vue3-vite',
  viteFinal: async (config) => ({
    ...config,
    plugins: [...(config.plugins || []), vue()],
  }),
}
