import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const { Client } = createRequire(new URL('../packages/server/package.json', import.meta.url))('pg')
const url = process.env.TEST_DATABASE_URL
const parsed = url && new URL(url)
if (!parsed || parsed.hostname !== '127.0.0.1' || !parsed.pathname.startsWith('/idea_map_test_')) {
  throw new Error('TEST_DATABASE_URL must point to an isolated local idea_map_test_ database')
}

test('public preview route serves only the approved generation and stops after withdrawal', async () => {
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])
  const calls = []
  const fakeStorage = createHttpServer((request, response) => {
    calls.push(request.url)
    const requestUrl = new URL(request.url, 'http://127.0.0.1')
    if (requestUrl.searchParams.get('generation') !== '123') { response.writeHead(400).end(); return }
    if (requestUrl.searchParams.get('alt') === 'media') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': image.length }).end(image)
    } else {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ size: String(image.length), contentType: 'image/png', generation: '123' }))
    }
  })
  await new Promise(resolve => fakeStorage.listen(0, '127.0.0.1', resolve))
  const probe = createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], { stdio: 'ignore', env: {
    ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DATABASE_URL: url,
    NUXT_APPROVED_MEDIA_BUCKET: 'synthetic-approved', NUXT_PENDING_MEDIA_BUCKET: 'synthetic-pending',
    NUXT_MEDIA_PREVIEW_MAX_BYTES: '1024', STORAGE_EMULATOR_HOST: `http://127.0.0.1:${fakeStorage.address().port}`,
  } })
  const base = `http://127.0.0.1:${port}`
  const db = new Client({ connectionString: url })
  const contactId = randomUUID(), ideaId = randomUUID(), revisionId = randomUUID(), previewId = randomUUID()
  let connected = false
  try {
    await db.connect(); connected = true
    await db.query("INSERT INTO contacts(id,normalized_email) VALUES ($1,'synthetic@example.invalid')", [contactId])
    await db.query("INSERT INTO ideas(id,author_contact_id,publication_state) VALUES ($1,$2,'approved')", [ideaId, contactId])
    await db.query("INSERT INTO idea_revisions(id,idea_id,version,content,review_state) VALUES ($1,$2,1,'{}','approved')", [revisionId, ideaId])
    await db.query('INSERT INTO approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [ideaId, revisionId])
    await db.query("INSERT INTO media_previews(id,idea_id,revision_id,object_name,generation,content_type,published) VALUES ($1,$2,$3,'synthetic/preview','123','image/png',true)", [previewId, ideaId, revisionId])
    let ready = false
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error('web server exited during startup')
      try { await fetch(`${base}/api/health`); ready = true; break } catch { await delay(250) }
    }
    assert.ok(ready)
    const response = await fetch(`${base}/api/media/${previewId}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image)
    assert.ok(calls.length >= 2)
    await db.query("UPDATE ideas SET publication_state='withdrawn' WHERE id=$1", [ideaId])
    const before = calls.length
    assert.equal((await fetch(`${base}/api/media/${previewId}`)).status, 404)
    assert.equal(calls.length, before)
  } finally {
    server.kill()
    fakeStorage.close()
    if (connected) {
      await db.query('DELETE FROM media_previews WHERE id=$1', [previewId])
      await db.query('DELETE FROM approved_revisions WHERE idea_id=$1', [ideaId])
      await db.query('DELETE FROM idea_revisions WHERE id=$1', [revisionId])
      await db.query('DELETE FROM ideas WHERE id=$1', [ideaId])
      await db.query('DELETE FROM contacts WHERE id=$1', [contactId])
      await db.end()
    }
  }
})
