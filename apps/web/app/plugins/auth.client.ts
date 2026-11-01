import { createBrowserAuth } from '../composables/browser-auth'

export default defineNuxtPlugin<{ browserAuth: Awaited<ReturnType<typeof createBrowserAuth>> | undefined }>(async () => {
  const config = useRuntimeConfig()
  const signedIn = useState<string | null>('auth-email', () => null)
  const authError = useState<string>('auth-error', () => '')
  try {
    const client = await createBrowserAuth({ apiKey: config.public.firebaseApiKey, authDomain: config.public.firebaseAuthDomain, projectId: config.public.firebaseProjectId, emulator: config.public.firebaseAuthEmulator })
    client.observe((value, error) => { signedIn.value = value; authError.value = error || '' })
    return { provide: { browserAuth: client } }
  } catch {
    authError.value = 'Sign-in is currently unavailable.'
    return { provide: { browserAuth: undefined } }
  }
})
