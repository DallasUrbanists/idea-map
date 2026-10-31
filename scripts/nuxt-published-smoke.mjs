import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl || !new URL(databaseUrl).pathname.startsWith('/idea_map_test_')) {
  throw new Error('TEST_DATABASE_URL must point to the disposable seeded idea_map_test_ database')
}
const approved = '11111111-1111-4111-8111-111111111111'
const privateIdea = '22222222-2222-4222-8222-222222222222'
const unapprovedRevision = '33333333-3333-4333-8333-333333333333'
const absent = '44444444-4444-4444-8444-444444444444'

test('SSR exposes only approved public projection and metadata', async () => {
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DATABASE_URL: databaseUrl, NUXT_API_SECRET: 'private-runtime-sentinel' },
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${port}`
  try {
    let health
    for (let n = 0; n < 60; n++) {
      if (server.exitCode !== null) throw new Error('server exited before starting')
      try { health = await fetch(base + '/api/health'); break } catch { await delay(250) }
    }
    assert.ok(health, 'server did not start')
    const api = await fetch(`${base}/api/ideas/${approved}`)
    assert.equal(api.status, 200)
    assert.deepEqual(await api.json(), { title: 'A safer crossing', description: 'A synthetic public idea.' })
    const page = await fetch(`${base}/suggestion/${approved}`)
    const html = await page.text()
    assert.equal(page.status, 200)
    assert.match(html, /<h1>A safer crossing<\/h1>/)
    assert.match(html, /property="og:title" content="A safer crossing"/)
    assert.match(html, /name="description" content="A synthetic public idea\."/)
    assert.match(html, /name="twitter:title" content="A safer crossing"/)
    for (const value of ['private-contact@example.invalid', 'private-runtime-sentinel', databaseUrl]) assert.ok(!html.includes(value))
    for (const id of [privateIdea, unapprovedRevision, absent]) {
      const response = await fetch(`${base}/api/ideas/${id}`)
      assert.equal(response.status, 404)
      assert.ok(!(await response.text()).includes('private-contact@example.invalid'))
      const hiddenPage = await fetch(`${base}/suggestion/${id}`)
      assert.equal(hiddenPage.status, 404)
      assert.ok(!(await hiddenPage.text()).includes('private-contact@example.invalid'))
    }
  } finally { server.kill() }
})
