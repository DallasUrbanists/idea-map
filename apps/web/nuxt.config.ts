export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: true,
  css: ['@fontsource-variable/figtree', '~~/src/styles/tokens.css'],
  // The Node server runtime supports ES2020, including BigInt literals.
  nitro: {
    esbuild: { options: { target: 'es2020' } },
    // Bundle shared local modules so dev output does not externalize their paths.
    externals: { inline: [/[/\\]shared[/\\]auth-provider\.mjs$/] },
  },
  runtimeConfig: {
    // NUXT_API_SECRET is private and is available only on the server.
    apiSecret: '',
    // NUXT_DATABASE_URL remains server-only and is never serialized.
    databaseUrl: '',
    // NUXT_RESEND_WEBHOOK_SECRET remains private to the server.
    resendWebhookSecret: '',
    stagingWebhookOnly: false,
    approvedMediaBucket: '',
    pendingMediaBucket: '',
    mediaPreviewMaxBytes: 0,
    mediaProviderMode: '',
    // Canonical browser origin; never infer this from request headers.
    sessionOrigin: '',
    firebaseProjectId: '',
    authProviderMode: '',
    ownershipClaimsEnabled: false,
    public: { siteName: 'Idea Map', firebaseApiKey: '', firebaseAuthDomain: '', firebaseProjectId: '', firebaseAuthEmulator: '', authProviderMode: '' },
  },
})
