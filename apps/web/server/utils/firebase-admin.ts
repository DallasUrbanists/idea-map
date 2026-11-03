import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { validateServerAuthMode } from '../../shared/auth-provider.mjs'

let selectedConfig: string | undefined

export function firebaseAdmin(projectId: string, mode: string) {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST || ''
  validateServerAuthMode(mode, projectId, emulator)
  const selected = JSON.stringify([mode, projectId, emulator])
  if (selectedConfig && selectedConfig !== selected) throw new Error('Authentication configuration cannot change without a restart')
  const existing = getApps().find(candidate => candidate.name === 'idea-map-auth')
  if (existing && !selectedConfig) throw new Error('Authentication must be initialized with a known configuration')
  const app = existing || initializeApp({ projectId }, 'idea-map-auth')
  if (app.options.projectId !== projectId) throw new Error('Authentication project mismatch')
  selectedConfig = selected
  return getAuth(app)
}
