export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: true,
  runtimeConfig: {
    // NUXT_API_SECRET is private and is available only on the server.
    apiSecret: '',
    // NUXT_DATABASE_URL remains server-only and is never serialized.
    databaseUrl: '',
    public: { siteName: 'Idea Map' },
  },
})
