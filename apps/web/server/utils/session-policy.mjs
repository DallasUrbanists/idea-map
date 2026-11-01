export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000
const FRESH_TOKEN_SECONDS = 5 * 60

/** The injected provider must verify signatures, expiry and revocation. */
export async function issueSession({ idToken, provider, nowSeconds = Math.floor(Date.now() / 1000) }) {
  if (typeof idToken !== 'string' || !idToken) throw new Error('Invalid credentials')
  const identity = await provider.verifyIdToken(idToken, true)
  if (!identity.uid || !identity.firebase?.sign_in_provider || identity.firebase.sign_in_provider === 'anonymous') {
    throw new Error('Registered identity required')
  }
  // A recently minted ID token permits persistent browser auth to recover even
  // after a server cookie expires. A token issued in the future is invalid.
  const age = nowSeconds - identity.iat
  if (!Number.isFinite(age) || age < 0 || age > FRESH_TOKEN_SECONDS) throw new Error('Fresh token required')
  return provider.createSessionCookie(idToken, { expiresIn: SESSION_LIFETIME_MS })
}
