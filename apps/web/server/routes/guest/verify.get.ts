import { createHash } from 'node:crypto'
import { setResponseHeader } from 'h3'

// This response deliberately has no application plugins or third-party scripts.
// The script runs in the head and removes the fragment before the user acts.
const script = `(() => {
  let proof = window.location.hash.slice(1)
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('status')
    const button = document.getElementById('verify')
    if (!proof || proof.length > 160) { proof = ''; status.textContent = 'This link is not valid. Request another verification link.'; return }
    button.hidden = false
    button.addEventListener('click', async () => {
      if (!proof || button.disabled) return
      const token = proof
      proof = ''
      button.disabled = true
      status.textContent = ''
      try {
        const response = await fetch('/api/guest/verify', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession' }, body: JSON.stringify({ token }) })
        if (!response.ok) { status.textContent = 'Verification could not be completed. Request another link.'; return }
        const result = await response.json()
        status.textContent = result.verified === true ? 'Your email has been verified.' : 'This link is invalid, expired, or already used. Request another link.'
      } catch { status.textContent = 'Verification could not be confirmed. Request another link.' }
      finally { button.hidden = true }
    })
  })
})()`
const style = `body { margin: 0; color: #17211b; background: #fff; font: 1rem/1.5 system-ui, sans-serif; }
main { max-width: 36rem; margin: 3rem auto; padding: 0 1rem; }
button { min-height: 44px; padding: .5rem 1rem; font: inherit; cursor: pointer; }
button:focus-visible { outline: 3px solid #126442; outline-offset: 2px; }`
const hash = (value: string) => createHash('sha256').update(value).digest('base64')
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>Verify your email</title><script>${script}</script><style>${style}</style></head><body><main><h1>Verify your email</h1><p>Use this link to verify the email address for your submission.</p><p id="status" role="status" aria-live="polite"></p><button id="verify" type="button" hidden>Verify email</button><noscript>JavaScript is required to use this verification link.</noscript></main></body></html>`

export default defineEventHandler(event => {
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  setResponseHeader(event, 'Content-Security-Policy', `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`)
  return html
})
