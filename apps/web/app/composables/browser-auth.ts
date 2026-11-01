import { getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, connectAuthEmulator, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onIdTokenChanged, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth'

const emulatorConnected = new WeakSet<object>()

// Called only from the browser. Public Firebase settings are identifiers, not secrets.
export async function createBrowserAuth(config: { apiKey: string, authDomain: string, projectId: string, emulator: string }) {
  if (!config.apiKey || !config.authDomain || !config.projectId) throw new Error('Authentication is not configured')
  const app = getApps().find(candidate => candidate.name === 'idea-map-web') || initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId }, 'idea-map-web')
  const auth = getAuth(app)
  if (config.emulator && !emulatorConnected.has(auth)) {
    if (!config.projectId.startsWith('demo-') || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(config.emulator)) throw new Error('Invalid emulator configuration')
    connectAuthEmulator(auth, config.emulator, { disableWarnings: true })
    emulatorConnected.add(auth)
  }
  await setPersistence(auth, browserLocalPersistence)
  let queue: Promise<void> = Promise.resolve()
  const session = (body: object) => {
    const operation = queue.catch(() => {}).then(async () => {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idea-Map-Session': 'IdeaMapSession' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('Could not update the server session')
    })
    queue = operation
    return operation
  }
  return {
    auth,
    observe(callback: (email: string | null, error?: string) => void) {
      return onIdTokenChanged(auth, async user => {
        if (!user || user.isAnonymous) {
          callback(null)
          void session({ action: 'logout' }).catch(() => callback(null, 'Could not clear the server session. Please retry sign-out.'))
          return
        }
        try {
          const result = await user.getIdTokenResult()
          const stale = Date.now() - Date.parse(result.issuedAtTime) > 4 * 60 * 1000
          const token = await user.getIdToken(stale)
          if (auth.currentUser !== user) return
          await session({ action: 'login', idToken: token })
          if (auth.currentUser === user) callback(user.email)
        }
        catch { if (auth.currentUser === user) callback(user.email, 'Your server session could not be refreshed. Retry or sign out.') }
      })
    },
    async register(email: string, password: string) { const result = await createUserWithEmailAndPassword(auth, email, password); await sendEmailVerification(result.user) },
    async login(email: string, password: string) { await signInWithEmailAndPassword(auth, email, password) },
    async google() { await signInWithPopup(auth, new GoogleAuthProvider()) },
    async reset(email: string) { await sendPasswordResetEmail(auth, email) },
    async verify() { if (auth.currentUser) await sendEmailVerification(auth.currentUser) },
    async logout() { await signOut(auth); await session({ action: 'logout' }) },
  }
}
