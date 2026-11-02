import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')
const databaseUrl = process.env.TEST_DATABASE_URL
const parsed = databaseUrl && new URL(databaseUrl)
if (!parsed || parsed.hostname !== '127.0.0.1' || !parsed.pathname.startsWith('/idea_map_test_')) {
  throw new Error('TEST_DATABASE_URL must point to an isolated local idea_map_test_ database')
}

async function startServer(config) {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DATABASE_URL: databaseUrl, ...config },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('web server exited during startup')
    try { await fetch(`${base}/api/health`); return { base, server } } catch { await delay(250) }
  }
  server.kill()
  throw new Error('web server did not start')
}

test('webhook verifies raw requests and acknowledges only durable events', async () => {
  const key = Buffer.from('synthetic-test-webhook-secret')
  const secret = `whsec_${key.toString('base64')}`
  const id = `synthetic-${randomUUID()}`
  const payload = JSON.stringify({ type: 'email.delivered', created_at: '2026-01-01T00:00:00Z', data: {
    email_id: 'synthetic-mail', to: ['sensitive@example.invalid'], subject: 'synthetic private content',
  } })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64')
  const headers = { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}`, 'content-type': 'application/json' }
  const { base, server } = await startServer({ NUXT_RESEND_WEBHOOK_SECRET: secret })
  const db = new Client({ connectionString: databaseUrl })
  await db.connect()
  try {
    const send = (body, extra = {}) => fetch(`${base}/api/webhooks/resend`, { method: 'POST', headers: { ...headers, ...extra }, body })
    const forged = await send(`${payload} `)
    assert.equal(forged.status, 400)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM email_delivery_events WHERE event_id = $1', [id])).rows[0].n, 0)
    const responses = await Promise.all([send(payload), send(payload)])
    assert.deepEqual(responses.map(response => response.status), [200, 200])
    assert.equal(responses[0].headers.get('cache-control'), 'private, no-store')
    const rows = await db.query('SELECT event_id, email_id, event_type FROM email_delivery_events WHERE event_id = $1', [id])
    assert.deepEqual(rows.rows, [{ event_id: id, email_id: 'synthetic-mail', event_type: 'email.delivered' }])
    assert.equal((await send(payload, { 'x-http-method-override': 'GET' })).status, 403)
    assert.equal((await send('x'.repeat(256 * 1024 + 1))).status, 413)
    assert.ok(!(await (await fetch(base)).text()).includes(secret))
  } finally {
    await db.query('DELETE FROM email_delivery_events WHERE event_id = $1', [id])
    await db.end()
    server.kill()
  }
  const unavailable = await startServer({ NUXT_RESEND_WEBHOOK_SECRET: secret, NUXT_DATABASE_URL: 'postgres://test:test@127.0.0.1:1/idea_map_test_unavailable' })
  try {
    const response = await fetch(`${unavailable.base}/api/webhooks/resend`, { method: 'POST', headers, body: payload })
    assert.equal(response.status, 503)
    assert.ok(!(await response.text()).includes(secret))
  } finally { unavailable.server.kill() }
})

test('isolated webhook service exposes only health and signed delivery events', async () => {
  const key = Buffer.from('synthetic-isolated-webhook-secret')
  const secret = `whsec_${key.toString('base64')}`
  const id = `synthetic-${randomUUID()}`
  const payload = JSON.stringify({ type: 'email.delivered', created_at: '2026-01-01T00:00:00Z', data: { email_id: 'synthetic-mail' } })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64')
  const { base, server } = await startServer({ NUXT_RESEND_WEBHOOK_SECRET: secret, NUXT_STAGING_WEBHOOK_ONLY: 'true' })
  const db = new Client({ connectionString: databaseUrl })
  await db.connect()
  try {
    for (const path of ['/', '/account', '/api/session', '/api/ideas/11111111-1111-4111-8111-111111111111', '/api/media/11111111-1111-4111-8111-111111111111']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path)
    }
    assert.equal((await fetch(`${base}/api/session`, { method: 'POST' })).status, 404)
    const headers = { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}`, 'content-type': 'application/json' }
    const response = await fetch(`${base}/api/webhooks/resend`, { method: 'POST', headers, body: payload })
    assert.equal(response.status, 200)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM email_delivery_events WHERE event_id = $1', [id])).rows[0].n, 1)
    assert.equal((await fetch(`${base}/api/webhooks/resend`, { method: 'POST', headers: { ...headers, 'x-http-method-override': 'GET' }, body: payload })).status, 403)
  } finally {
    await db.query('DELETE FROM email_delivery_events WHERE event_id = $1', [id])
    await db.end()
    server.kill()
  }
})
