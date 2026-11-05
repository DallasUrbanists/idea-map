import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGoogleRecoverySequenceTransport } from '../dist/recovery-sequence-google.js'

const parent = 'projects/123456789/secrets/synthetic-recovery'
const auth = { async getAccessToken() { return 'synthetic-token' } }

test('transport uses the fixed Secret Manager endpoint and exact version paths', async () => {
  const calls = []
  const transport = createGoogleRecoverySequenceTransport(auth, async (url, options) => {
    calls.push({ url, ...options })
    return new Response(JSON.stringify({ name: 'synthetic' }), { status: 200 })
  })
  const signal = new AbortController().signal
  assert.deepEqual(await transport.request('POST', `${parent}:addVersion`, { payload: { data: 'c3ludGhldGlj' } }, signal),
    { status: 200, data: { name: 'synthetic' } })
  assert.deepEqual(await transport.request('GET', `${parent}/versions/7:access`, null, signal),
    { status: 200, data: { name: 'synthetic' } })
  assert.equal(calls[0].url, `https://secretmanager.googleapis.com/v1/${parent}:addVersion`)
  assert.equal(calls[0].headers.authorization, 'Bearer synthetic-token')
  assert.equal(calls[0].redirect, 'error')
  assert.equal(calls[0].cache, 'no-store')
  assert.equal(calls[1].body, undefined)
  await assert.rejects(transport.request('GET', `${parent}/versions/latest:access`, null, signal), /Invalid/)
  await transport.request('GET', `${parent}/versions/90071992547409931234:access`, null, signal)
  assert.equal(calls[2].url, `https://secretmanager.googleapis.com/v1/${parent}/versions/90071992547409931234:access`)
  await assert.rejects(transport.request('GET', `${parent}/versions/100000000000000000000:access`, null, signal), /Invalid/)
  await assert.rejects(transport.request('POST', 'https://untrusted.invalid', {}, signal), /Invalid/)
  await assert.rejects(transport.request('POST', `${parent}:addVersion`, { data: 'x'.repeat(65_536) }, signal), /Invalid/)
  await assert.rejects(transport.request('GET', `${parent}/versions/1:access`, {}, signal), /Invalid/)
  assert.equal(calls.length, 3)
})

test('transport limits response size and hides provider error bodies', async () => {
  const denied = createGoogleRecoverySequenceTransport(auth, async () => new Response('synthetic private details', { status: 403 }))
  assert.deepEqual(await denied.request('GET', `${parent}/versions/1:access`, null, new AbortController().signal), { status: 403, data: null })
  const tooLarge = createGoogleRecoverySequenceTransport(auth, async () => new Response('x'.repeat(65_537), { status: 200 }))
  await assert.rejects(tooLarge.request('GET', `${parent}/versions/1:access`, null, new AbortController().signal),
    error => error.message === 'Recovery sequence transport unavailable' && !error.message.includes('private'))
  const malformed = createGoogleRecoverySequenceTransport(auth, async () => new Response('synthetic private text', { status: 200 }))
  await assert.rejects(malformed.request('GET', `${parent}/versions/1:access`, null, new AbortController().signal),
    /transport unavailable/)
  const brokenAuth = createGoogleRecoverySequenceTransport({ async getAccessToken() { throw new Error('synthetic private credential') } },
    async () => { throw new Error('Unexpected network call') })
  await assert.rejects(brokenAuth.request('GET', `${parent}/versions/1:access`, null, new AbortController().signal),
    error => error.message === 'Recovery sequence transport unavailable' && !error.message.includes('private'))
})

test('late credentials cannot start a request after cancellation', async () => {
  let complete, calls = 0
  const provider = { getAccessToken() { return new Promise(resolve => { complete = resolve }) } }
  const transport = createGoogleRecoverySequenceTransport(provider, async () => { calls++; return new Response('{}') })
  const controller = new AbortController()
  const pending = transport.request('GET', `${parent}/versions/1:access`, null, controller.signal)
  controller.abort()
  complete('synthetic-token')
  await assert.rejects(pending, /transport unavailable/)
  assert.equal(calls, 0)
})
