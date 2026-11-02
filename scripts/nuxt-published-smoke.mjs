import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl || !new URL(databaseUrl).pathname.startsWith('/idea_map_test_')) {
  throw new Error('TEST_DATABASE_URL must point to the disposable seeded idea_map_test_ database')
}
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

test('shared HTML caching is limited to the isolated staging service', async () => {
  const cases = [
    { name: 'default configuration', env: {}, expected: 'private, no-store' },
    { name: 'flag disabled', env: { ...stagingEnvironment, NUXT_STAGING_HTML_CACHE: 'false' }, expected: 'private, no-store' },
    { name: 'different project', env: { ...stagingEnvironment, NUXT_FIREBASE_PROJECT_ID: 'other-project' }, expected: 'private, no-store' },
    { name: 'different origin', env: { ...stagingEnvironment, NUXT_SESSION_ORIGIN: 'https://example.invalid' }, expected: 'private, no-store' },
    { name: 'different service', env: { ...stagingEnvironment, K_SERVICE: 'idea-map-web-prod' }, expected: 'private, no-store' },
    { name: 'isolated staging', env: stagingEnvironment, expected: 'public, max-age=0, s-maxage=60, must-revalidate' },
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
    assert.equal(page.headers.get('cache-control'), 'public, max-age=0, s-maxage=60, must-revalidate')
    assert.match(page.headers.get('vary'), /cookie/i)
    assert.match(page.headers.get('vary'), /authorization/i)
    assert.match(html, /<h1>A safer crossing<\/h1>/)
    assert.match(html, /property="og:title" content="A safer crossing"/)
    assert.match(html, /name="description" content="A synthetic public idea\."/)
    assert.match(html, /name="twitter:title" content="A safer crossing"/)
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
