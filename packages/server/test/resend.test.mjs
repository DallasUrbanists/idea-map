import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { Resend } from 'resend'
import { receiveDeliveryWebhook, sendTransactionalEmail } from '../dist/resend.js'

const secretBytes = Buffer.from('synthetic signing secret for tests')
const secret = `whsec_${secretBytes.toString('base64')}`
const makeRequest = (payload, id = 'msg_test', time = Math.floor(Date.now() / 1000)) => {
  const timestamp = String(time)
  const signature = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${payload}`).digest('base64')
  return { payload, id, timestamp, signature: `v1,${signature}` }
}
const payload = JSON.stringify({ type: 'email.delivered', created_at: '2026-01-01T00:00:00Z', data: {
  email_id: 'synthetic-email', to: ['private@example.invalid'], subject: 'private content',
} })

test('verified delivery events are minimized, deduplicated, and persisted before acknowledgement', async () => {
  const events = new Map()
  const store = { async insert(event) {
    if (events.has(event.eventId)) return 'duplicate'
    events.set(event.eventId, event)
    return 'inserted'
  } }
  const request = makeRequest(payload)
  assert.equal(await receiveDeliveryWebhook(request, secret, store), 'stored')
  assert.deepEqual(events.get('msg_test'), { eventId: 'msg_test', emailId: 'synthetic-email', type: 'email.delivered', occurredAt: '2026-01-01T00:00:00Z' })
  assert.equal(await receiveDeliveryWebhook(request, secret, store), 'duplicate')
  assert.equal(await receiveDeliveryWebhook(makeRequest(payload, 'msg_retry'), secret, { async insert() { throw new Error('private database error') } }), 'retry')
})

test('invalid, expired, oversized, and malformed webhooks never reach the store', async () => {
  const store = { async insert() { assert.fail('untrusted event reached the store') } }
  const request = makeRequest(payload)
  assert.equal(await receiveDeliveryWebhook({ ...request, payload: `${payload} ` }, secret, store), 'invalid')
  assert.equal(await receiveDeliveryWebhook(makeRequest(payload, 'msg_old', Math.floor(Date.now() / 1000) - 600), secret, store), 'invalid')
  assert.equal(await receiveDeliveryWebhook(makeRequest('x'.repeat(256 * 1024 + 1)), secret, store), 'invalid')
  assert.equal(await receiveDeliveryWebhook(makeRequest('{"type":"email.delivered","data":{}}'), secret, store), 'invalid')
  assert.equal(await receiveDeliveryWebhook(makeRequest('{"type":"contact.updated"}'), secret, store), 'ignored')
})

test('email submission sends a stable idempotency key and handles uncertain outcomes', async (t) => {
  const client = new Resend('synthetic-key', { baseUrl: 'https://example.invalid' })
  const message = { from: 'sender@example.invalid', to: 'test@example.invalid', subject: 'Test', text: 'Synthetic' }
  let response = new Response(JSON.stringify({ id: 'mail_123' }), { status: 200 })
  const fetch = t.mock.method(globalThis, 'fetch', async () => response)
  assert.deepEqual(await sendTransactionalEmail(client, message, 'job/123'), { status: 'accepted', providerId: 'mail_123' })
  const options = fetch.mock.calls[0].arguments[1]
  assert.equal(options.headers.get('Idempotency-Key'), 'job/123')
  assert.deepEqual(JSON.parse(options.body), message)
  response = new Response(JSON.stringify({ statusCode: 400, message: 'private detail', name: 'validation_error' }), { status: 400 })
  assert.deepEqual(await sendTransactionalEmail(client, message, 'job/123'), { status: 'rejected', httpStatus: 400 })
  response = new Response(JSON.stringify({ statusCode: 500, message: 'private detail', name: 'application_error' }), { status: 500 })
  assert.deepEqual(await sendTransactionalEmail(client, message, 'job/123'), { status: 'unknown' })
  fetch.mock.mockImplementation(async () => { throw new Error('network failure') })
  assert.deepEqual(await sendTransactionalEmail(client, message, 'job/123'), { status: 'unknown' })
  await assert.rejects(sendTransactionalEmail(client, message, ''), /Invalid email idempotency key/)
})
