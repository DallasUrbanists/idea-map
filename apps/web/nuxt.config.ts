export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: true,
  css: ['~~/src/styles/tokens.css'],
  // The Node server runtime supports ES2020, including BigInt literals.
  nitro: { esbuild: { options: { target: 'es2020' } } },
  runtimeConfig: {
    // NUXT_API_SECRET is private and is available only on the server.
    apiSecret: '',
    // NUXT_DATABASE_URL remains server-only and is never serialized.
    databaseUrl: '',
    // Canonical browser origin; never infer this from request headers.
    sessionOrigin: '',
    firebaseProjectId: '',
    public: { siteName: 'Idea Map', firebaseApiKey: '', firebaseAuthDomain: '', firebaseProjectId: '', firebaseAuthEmulator: '' },
  },
})
