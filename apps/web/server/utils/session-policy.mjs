export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000
const RECENT_AUTH_SECONDS = 5 * 60

/** The injected provider must verify signatures, expiry and revocation. */
export async function issueSession({ idToken, existingCookie, provider, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (typeof idToken !== 'string' || !idToken) throw new Error('Invalid credentials')
  const identity = await provider.verifyIdToken(idToken, true)
  if (!identity.uid || identity.firebase?.sign_in_provider === 'anonymous' || !identity.firebase?.sign_in_provider) {
    throw new Error('Registered identity required')
  }
  const age = nowSeconds - identity.auth_time
  const recent = Number.isFinite(age) && age >= 0 && age <= RECENT_AUTH_SECONDS
  if (!recent) {
    if (!existingCookie) throw new Error('Recent sign-in required')
    const session = await provider.verifySessionCookie(existingCookie, true)
    if (session.uid !== identity.uid || !session.firebase?.sign_in_provider || session.firebase.sign_in_provider === 'anonymous') throw new Error('Session identity mismatch')
  }
  return provider.createSessionCookie(idToken, { expiresIn: SESSION_LIFETIME_MS })
}
