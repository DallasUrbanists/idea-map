import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { trackAuthTestAccounts } from './auth-emulator-accounts.mjs'

// Run after building, with a disposable demo-idea-map Auth emulator on 9099.
test('session endpoint verifies emulator credentials and enforces CSRF and cookie policy', async () => {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_SESSION_ORIGIN: base, NUXT_FIREBASE_PROJECT_ID: 'demo-idea-map', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, stdio: 'ignore',
  })
  const accounts = trackAuthTestAccounts()
  try {
    let ready = false
    for (let i = 0; i < 80; i++) {
      if (server.exitCode !== null) throw new Error('server exited')
      try { await fetch(`${base}/api/health`); ready = true; break } catch { await delay(250) }
    }
    assert.ok(ready)
    const signup = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `test-${randomUUID()}@example.test`, password: 'test-password', returnSecureToken: true }),
    })
    assert.equal(signup.status, 200)
    const { idToken } = await signup.json()
    accounts.add('registered', idToken)
    const headers = { origin: base, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession' }
    const request = (body, extra = {}) => fetch(`${base}/api/session`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
    assert.equal((await request({ action: 'login', idToken }, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await request({ action: 'login', idToken }, { 'x-http-method-override': 'DELETE' })).status, 403)
    assert.equal((await request({ action: 'login', idToken: 'forged' })).status, 401)
    assert.equal((await request({ action: 'login', idToken: 'x'.repeat(33000) })).status, 413)
    const anonymous = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })
    assert.equal(anonymous.status, 200)
    const anonymousToken = (await anonymous.json()).idToken
    accounts.add('anonymous', anonymousToken)
    assert.equal((await request({ action: 'login', idToken: anonymousToken })).status, 401)
    // This synthetic credential exercises server-session verification only; it
    // does not exercise the browser's Google popup or a real Google provider.
    const jwtPart = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const googleCredential = `${jwtPart({ alg: 'none', typ: 'JWT' })}.${jwtPart({ sub: randomUUID(), email: `google-${randomUUID()}@example.test`, email_verified: true })}.`
    const google = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-key', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        postBody: new URLSearchParams({ id_token: googleCredential, providerId: 'google.com' }).toString(),
        requestUri: 'http://localhost', returnSecureToken: true,
      }),
    })
    assert.equal(google.status, 200)
    const googleAccount = await google.json()
    accounts.add('google', googleAccount.idToken)
    assert.equal(googleAccount.providerId, 'google.com')
    assert.equal(googleAccount.isNewUser, true)
    const googleLogin = await request({ action: 'login', idToken: googleAccount.idToken })
    assert.equal(googleLogin.status, 200)
    const googleCookie = googleLogin.headers.get('set-cookie').split(';')[0]
    assert.deepEqual(await (await fetch(base + '/api/session', { headers: { cookie: googleCookie } })).json(), { registered: true, emailVerified: true })
    const login = await request({ action: 'login', idToken })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')
    assert.match(cookie, /^__session=/)
    assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Lax/i)
    assert.match(login.headers.get('cache-control'), /no-store/)
    const status = await fetch(base + '/api/session', { headers: { cookie: cookie.split(';')[0] } })
    assert.deepEqual(await status.json(), { registered: true, emailVerified: false })
    const invalid = await fetch(base + '/api/session', { headers: { cookie: '__session=forged' } })
    assert.deepEqual(await invalid.json(), { registered: false })
    const logout = await request({ action: 'logout' })
    assert.equal(logout.status, 200)
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i)
    assert.equal((await fetch(`${base}/api/health`, { method: 'POST' })).status, 403)
  } finally {
    server.kill()
    await accounts.cleanup()
  }
})
