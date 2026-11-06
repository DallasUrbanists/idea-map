import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { createServer as createHttpServer, get as httpGet } from 'node:http'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { coordinateSequenceRemoval } from '../packages/server/dist/pending-removal.js'
import { pendingRemovalDatabasePool } from '../packages/server/dist/runtime-database.js'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl || !new URL(databaseUrl).pathname.startsWith('/idea_map_test_') ||
    !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('TEST_DATABASE_URL must point to a local disposable seeded idea_map_test_ database')
}
let originalGate
before(async () => {
  const db = new Client({ connectionString: databaseUrl })
  await db.connect()
  try {
    const result = await db.query('SELECT is_open FROM public.public_access_gate WHERE singleton=true')
    if (result.rows.length !== 1) throw new Error('Synthetic gate is missing')
    originalGate = result.rows[0].is_open
    await db.query('UPDATE public.public_access_gate SET is_open=true WHERE singleton=true')
  } finally { await db.end() }
})
after(async () => {
  if (originalGate === undefined) return
  const db = new Client({ connectionString: databaseUrl })
  await db.connect()
  try { await db.query('UPDATE public.public_access_gate SET is_open=$1 WHERE singleton=true', [originalGate]) }
  finally { await db.end() }
})
const approved = '11111111-1111-4111-8111-111111111111'
const privateIdea = '22222222-2222-4222-8222-222222222222'
const unapprovedRevision = '33333333-3333-4333-8333-333333333333'
const absent = '44444444-4444-4444-8444-444444444444'

const stagingEnvironment = {
  NUXT_STAGING_HTML_CACHE: 'true',
  NUXT_FIREBASE_PROJECT_ID: 'dallasurbanists-idea-map-dev',
  NUXT_SESSION_ORIGIN: 'https://staging.ideam.app',
  K_SERVICE: 'idea-map-ssr-staging',
}

async function startServer(overrides) {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
    env: {
      ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DATABASE_URL: databaseUrl,
      NUXT_API_SECRET: 'private-runtime-sentinel', NUXT_STAGING_HTML_CACHE: 'false',
      NUXT_FIREBASE_PROJECT_ID: '', NUXT_SESSION_ORIGIN: '', K_SERVICE: '', ...overrides,
    },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  let health
  for (let n = 0; n < 60; n++) {
    if (server.exitCode !== null) throw new Error('server exited before starting')
    try { health = await fetch(base + '/api/health'); break } catch { await delay(250) }
  }
  if (!health) {
    server.kill()
    throw new Error('server did not start')
  }
  return { base, server }
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return
  const stopped = once(server, 'exit')
  server.kill()
  await stopped
}

test('guarded idea HTML is never shared, including in the isolated staging service', async () => {
  const cases = [
    { name: 'default configuration', env: {}, expected: 'private, no-store' },
    { name: 'flag disabled', env: { ...stagingEnvironment, NUXT_STAGING_HTML_CACHE: 'false' }, expected: 'private, no-store' },
    { name: 'different project', env: { ...stagingEnvironment, NUXT_FIREBASE_PROJECT_ID: 'other-project' }, expected: 'private, no-store' },
    { name: 'different origin', env: { ...stagingEnvironment, NUXT_SESSION_ORIGIN: 'https://example.invalid' }, expected: 'private, no-store' },
    { name: 'different service', env: { ...stagingEnvironment, K_SERVICE: 'idea-map-web-prod' }, expected: 'private, no-store' },
    { name: 'isolated staging', env: stagingEnvironment, expected: 'private, no-store' },
  ]
  for (const { name, env, expected } of cases) {
    const { base, server } = await startServer(env)
    try {
      for (const method of ['GET', 'HEAD']) {
        const page = await fetch(`${base}/suggestion/${approved}`, { method })
        assert.equal(page.status, 200, `${name}: ${method}`)
        assert.equal(page.headers.get('cache-control'), expected, `${name}: ${method}`)
      }
    } finally { server.kill() }
  }
})

test('SSR exposes only approved public projection and metadata', async () => {
  const { base, server } = await startServer(stagingEnvironment)
  try {
    const api = await fetch(`${base}/api/ideas/${approved}`)
    assert.equal(api.status, 200)
    assert.deepEqual(await api.json(), { title: 'A safer crossing', description: 'A synthetic public idea.' })
    const page = await fetch(`${base}/suggestion/${approved}`)
    const html = await page.text()
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('cache-control'), 'private, no-store')
    assert.match(html, /<h1>A safer crossing<\/h1>/)
    assert.match(html, /property="og:title" content="A safer crossing"/)
    assert.match(html, /name="description" content="A synthetic public idea\."/)
    assert.match(html, /name="twitter:title" content="A safer crossing"/)
    const simultaneous = await Promise.all(Array.from({ length: 3 }, () => fetch(`${base}/suggestion/${approved}`)))
    assert.ok(simultaneous.every(response => response.status === 200))
    await Promise.all(simultaneous.map(response => response.arrayBuffer()))
    const inspection = new Client({ connectionString: databaseUrl })
    await inspection.connect()
    try {
      let active = -1
      for (let attempt = 0; attempt < 40; attempt++) {
        active = (await inspection.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0].count
        if (active === 0) break
        await delay(50)
      }
      assert.equal(active, 0, 'public response left a transaction open')
    } finally { await inspection.end() }
    for (const value of ['private-contact@example.invalid', 'private-runtime-sentinel', databaseUrl]) assert.ok(!html.includes(value))
    for (const headers of [{ cookie: '__session=forged' }, { authorization: 'Bearer forged' }, { cookie: 'unrelated=value' }]) {
      const response = await fetch(`${base}/suggestion/${approved}`, { headers })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
    }
    for (const id of [privateIdea, unapprovedRevision, absent]) {
      const response = await fetch(`${base}/api/ideas/${id}`)
      assert.equal(response.status, 404)
      assert.ok(!(await response.text()).includes('private-contact@example.invalid'))
      const hiddenPage = await fetch(`${base}/suggestion/${id}`)
      assert.equal(hiddenPage.status, 404)
      assert.equal(hiddenPage.headers.get('cache-control'), 'private, no-store')
      assert.ok(!(await hiddenPage.text()).includes('private-contact@example.invalid'))
    }
    // This changes only the disposable fixture and restores it even if an assertion fails.
    const db = new Client({ connectionString: databaseUrl })
    await db.connect()
    try {
      await db.query("UPDATE ideas SET publication_state = 'private' WHERE id = $1", [approved])
      const withdrawn = await fetch(`${base}/suggestion/${approved}`)
      assert.equal(withdrawn.status, 404)
      assert.equal(withdrawn.headers.get('cache-control'), 'private, no-store')
    } finally {
      await db.query("UPDATE ideas SET publication_state = 'approved' WHERE id = $1", [approved])
      await db.end()
    }
  } finally { server.kill() }
})

test('closed gate blocks idea pages, APIs, and media while health remains available', async () => {
  const { base, server } = await startServer({})
  const db = new Client({ connectionString: databaseUrl })
  await db.connect()
  try {
    await db.query('UPDATE public.public_access_gate SET is_open=false WHERE singleton=true')
    for (const path of [`/api/ideas/${approved}`, `/suggestion/${approved}`,
      `/suggestion/%31${approved.slice(1)}`, `/api/media/${approved}`]) {
      const response = await fetch(base + path, { headers: { 'x-probe-lease': 'forged' } })
      assert.equal(response.status, 503, path)
      assert.match(response.headers.get('cache-control'), /no-store/)
      assert.ok(!(await response.text()).includes('A safer crossing'))
    }
    for (const path of [`/%73uggestion/${approved}`, `/%2573uggestion/${approved}`,
      `/suggestion/%2531${approved.slice(1)}`, `/api/ideas/%31${approved.slice(1)}`]) {
      const response = await fetch(base + path)
      assert.notEqual(response.status, 200, path)
      assert.ok(!(await response.text()).includes('A safer crossing'))
    }
    assert.equal((await fetch(`${base}/api/health`)).status, 200)
  } finally {
    await db.query('UPDATE public.public_access_gate SET is_open=true WHERE singleton=true')
    await db.end()
    server.kill()
  }
})

test('a journal outage keeps public content closed across a web restart', async () => {
  const db = new Client({ connectionString: databaseUrl })
  const actor = randomUUID(), operationId = randomUUID(), recordId = randomUUID()
  const subject = `synthetic-${randomUUID()}`
  const session = { uid: subject, email: 'moderator@example.invalid', email_verified: true,
    firebase: { sign_in_provider: 'password' } }
  const verifier = { async verifySessionCookie() { return session }, async getUser() {
    return { uid: subject, email: session.email, emailVerified: true, disabled: false }
  } }
  const unavailable = { async request() { throw new Error('synthetic journal outage') } }
  const target = { environment: 'dev', projectNumber: '123456789', secretId: 'synthetic-journal', epochId: randomUUID() }
  let server, poolUsed = false, setup = false
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query('INSERT INTO public.users(id) VALUES ($1)', [actor])
    await db.query("INSERT INTO public.identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map',$2)", [actor, subject])
    await db.query("INSERT INTO public.moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic authority')", [actor])
    await db.query('COMMIT')
    setup = true
    const first = await startServer(stagingEnvironment)
    server = first.server
    assert.equal((await fetch(`${first.base}/suggestion/${approved}`)).status, 200)
    poolUsed = true
    const outcome = await coordinateSequenceRemoval(databaseUrl, databaseUrl, 'demo-idea-map', 'synthetic-cookie',
      verifier, target, unavailable, unavailable, { operationId, recordId, ideaId: approved,
        approvedRevisionId: 'aaaaaaaa-1111-4111-8111-111111111111', classification: 'other', reason: 'synthetic removal' })
    assert.deepEqual(outcome, { state: 'authorized', value: 'journal_uncertain' })
    assert.equal((await db.query('SELECT is_open FROM public.public_access_gate WHERE singleton=true')).rows[0].is_open, false)
    assert.equal((await db.query('SELECT publication_state FROM public.ideas WHERE id=$1', [approved])).rows[0].publication_state, 'approved')
    const blocked = await fetch(`${first.base}/suggestion/${approved}`)
    assert.equal(blocked.status, 503)
    assert.match(blocked.headers.get('cache-control'), /no-store/)
    await stopServer(server)
    server = undefined
    const restarted = await startServer(stagingEnvironment)
    server = restarted.server
    for (const path of [`/suggestion/${approved}`, `/api/ideas/${approved}`, `/api/media/${approved}`]) {
      const response = await fetch(restarted.base + path)
      assert.equal(response.status, 503, path)
      assert.match(response.headers.get('cache-control'), /no-store/)
    }
  } finally {
    try {
      if (server) await stopServer(server)
      if (poolUsed) await pendingRemovalDatabasePool(databaseUrl).end()
      if (setup) {
        // The disposable test database protects audit records from deletion.
        // Disable triggers only inside this cleanup transaction, for this test's
        // synthetic IDs, and restore normal behavior when it commits or rolls back.
        await db.query('BEGIN')
        try {
          await db.query("SET LOCAL session_replication_role = 'replica'")
          await db.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])
          await db.query("DELETE FROM public.public_access_closures WHERE kind='removal' AND cause_id=$1", [operationId])
          await db.query('DELETE FROM public.moderator_assignments WHERE user_id=$1', [actor])
          await db.query('DELETE FROM public.identities WHERE user_id=$1', [actor])
          await db.query('DELETE FROM public.users WHERE id=$1', [actor])
          await db.query('COMMIT')
        } catch (error) { await db.query('ROLLBACK'); throw error }
      } else await db.query('ROLLBACK').catch(() => {})
    } finally {
      try { await db.query('UPDATE public.public_access_gate SET is_open=true WHERE singleton=true') }
      finally { await db.end() }
    }
  }
})

test('a committed gate closure aborts an in-flight synthetic media fetch before drain', async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  let mediaResponse, markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const fake = createHttpServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.searchParams.get('generation') !== '1' || url.searchParams.get('ifGenerationMatch') !== '1') {
      response.writeHead(400).end()
    } else if (url.searchParams.get('alt') === 'media') {
      mediaResponse = response
      markStarted()
    } else {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ generation: '1', size: String(bytes.length), contentType: 'image/png' }))
    }
  })
  await new Promise((resolve, reject) => fake.once('error', reject).listen(0, '127.0.0.1', resolve))
  const db = new Client({ connectionString: databaseUrl })
  const writer = new Client({ connectionString: databaseUrl })
  const previewId = randomUUID()
  let server, request, closing
  try {
    await db.connect()
    await writer.connect()
    await db.query(`INSERT INTO public.media_previews(id,idea_id,revision_id,object_name,generation,content_type,published)
      VALUES ($1,$2,$3,$4,'1','image/png',true)`, [previewId, approved, 'aaaaaaaa-1111-4111-8111-111111111111', `synthetic/${previewId}`])
    const launched = await startServer({ NUXT_APPROVED_MEDIA_BUCKET: 'synthetic-approved', NUXT_PENDING_MEDIA_BUCKET: 'synthetic-pending',
      NUXT_MEDIA_PROVIDER_MODE: 'offline', NUXT_MEDIA_PREVIEW_MAX_BYTES: String(bytes.length), STORAGE_EMULATOR_HOST: `http://127.0.0.1:${fake.address().port}` })
    server = launched.server
    request = httpGet(`${launched.base}/api/media/${previewId}`)
    const disconnected = new Promise(resolve => request.once('error', resolve))
    await Promise.race([started, delay(4000).then(() => { throw new Error('Synthetic media fetch did not start') })])
    // Close first without waiting for the active read lease. The independently
    // committed state must prevent later reads while this response drains.
    await writer.query('UPDATE public.public_access_gate SET is_open=false WHERE singleton=true')
    assert.equal((await fetch(`${launched.base}/api/ideas/${approved}`)).status, 503)
    await Promise.race([disconnected, delay(2000).then(() => { throw new Error('Synthetic client did not disconnect') })])
    await writer.query('BEGIN')
    await writer.query("SET LOCAL lock_timeout = '5s'")
    closing = writer.query('SELECT pg_catalog.pg_advisory_xact_lock(726421, 391)')
    closing.catch(() => {})
    await closing
    mediaResponse.end(bytes)
    await writer.query('COMMIT')
    assert.equal((await fetch(`${launched.base}/api/ideas/${approved}`)).status, 503)
  } finally {
    request?.destroy()
    mediaResponse?.destroy()
    if (closing) await closing.catch(() => {})
    await writer.query('ROLLBACK').catch(() => {})
    await db.query('DELETE FROM public.media_previews WHERE id=$1', [previewId]).catch(() => {})
    await db.query('UPDATE public.public_access_gate SET is_open=true WHERE singleton=true').catch(() => {})
    await writer.end().catch(() => {})
    await db.end().catch(() => {})
    server?.kill()
    await new Promise(resolve => fake.close(resolve))
  }
})
