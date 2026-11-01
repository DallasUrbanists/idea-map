import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

export function firebaseAdmin(projectId: string) {
  const app = getApps().find(candidate => candidate.name === 'idea-map-auth')
    || initializeApp({ projectId }, 'idea-map-auth')
  return getAuth(app)
}
