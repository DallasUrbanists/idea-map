export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: true,
  runtimeConfig: {
    // NUXT_API_SECRET is private and is available only on the server.
    apiSecret: '',
    public: { siteName: 'Idea Map' },
  },
})
