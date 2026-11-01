import { getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, connectAuthEmulator, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth'

const emulatorConnected = new WeakSet<object>()
const RENEW_SESSION_MS = 50 * 60 * 1000
const RETRY_SESSION_MS = 60 * 1000

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
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let refreshingUser: User | null = null
      const clearTimer = () => { clearTimeout(timer); timer = undefined }
      const refresh = async (user: User) => {
        if (stopped || auth.currentUser !== user || refreshingUser === user) return
        clearTimer()
        refreshingUser = user
        let nextRefresh = RENEW_SESSION_MS
        try {
          // Always fetch current claims, including a recently verified email.
          const token = await user.getIdToken(true)
          if (stopped || auth.currentUser !== user) return
          await session({ action: 'login', idToken: token })
          if (!stopped && auth.currentUser === user) callback(user.email)
        }
        catch {
          nextRefresh = RETRY_SESSION_MS
          if (!stopped && auth.currentUser === user) callback(user.email, 'Your server session could not be refreshed. Retrying automatically, or sign out.')
        }
        finally {
          if (refreshingUser === user) refreshingUser = null
          if (!stopped && auth.currentUser === user) timer = setTimeout(() => { void refresh(user) }, nextRefresh)
        }
      }
      const resume = () => {
        const user = auth.currentUser
        if (user && !user.isAnonymous) void refresh(user)
      }
      // Track sign-in/out separately from token changes so forced refreshes
      // cannot feed back into the observer (including across browser tabs).
      // Timers renew open tabs; focus/online recover after sleep or disconnection.
      window.addEventListener('focus', resume)
      window.addEventListener('online', resume)
      const unsubscribe = onAuthStateChanged(auth, user => {
        clearTimer()
        if (!user || user.isAnonymous) {
          callback(null)
          void session({ action: 'logout' }).catch(() => callback(null, 'Could not clear the server session. Please retry sign-out.'))
          return
        }
        void refresh(user)
      })
      return () => {
        stopped = true
        clearTimer()
        unsubscribe()
        window.removeEventListener('focus', resume)
        window.removeEventListener('online', resume)
      }
    },
    async register(email: string, password: string) { const result = await createUserWithEmailAndPassword(auth, email, password); await sendEmailVerification(result.user) },
    async login(email: string, password: string) { await signInWithEmailAndPassword(auth, email, password) },
    async google() { await signInWithPopup(auth, new GoogleAuthProvider()) },
    async reset(email: string) { await sendPasswordResetEmail(auth, email) },
    async verify() { if (auth.currentUser) await sendEmailVerification(auth.currentUser) },
    async logout() { await signOut(auth); await session({ action: 'logout' }) },
  }
}
