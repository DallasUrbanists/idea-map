import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { exactGenerationFile } from '../packages/server/dist/storage-generation.js'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')
const { Storage } = require('@google-cloud/storage')
const url = process.env.TEST_DATABASE_URL
const parsed = url && new URL(url)
if (process.env.IDEA_MAP_ALLOW_STAGING_MEDIA_TEST !== 'yes' || process.env.STORAGE_EMULATOR_HOST || !parsed || parsed.hostname !== '127.0.0.1' || !parsed.pathname.startsWith('/idea_map_test_')) {
  throw new Error('Opt in to the staging media check and supply an isolated local idea_map_test_ database')
}

test('local public preview endpoint reads only approved staging object generations', async () => {
  const bucketName = 'dallasurbanists-idea-map-dev-media-previews'
  const objectName = `issue16-synthetic/${randomUUID()}.png`
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmN8AAAAASUVORK5CYII=', 'base64')
  const storage = new Storage({ projectId: 'dallasurbanists-idea-map-dev' })
  const file = storage.bucket(bucketName).file(objectName)
  const db = new Client({ connectionString: url })
  const contactId = randomUUID(), ideaId = randomUUID(), revisionId = randomUUID(), previewId = randomUUID()
  let generation, created = false, connected = false, server
  try {
    await file.save(image, { resumable: false, contentType: 'image/png', preconditionOpts: { ifGenerationMatch: 0 } }); created = true
    generation = String((await file.getMetadata())[0].generation)
    if (!/^[1-9][0-9]*$/.test(generation)) throw new Error('Could not identify test object generation')
    await db.connect(); connected = true
    await db.query("INSERT INTO contacts(id,normalized_email) VALUES ($1,'synthetic@example.invalid')", [contactId])
    await db.query("INSERT INTO ideas(id,author_contact_id,publication_state) VALUES ($1,$2,'approved')", [ideaId, contactId])
    await db.query("INSERT INTO idea_revisions(id,idea_id,version,content,review_state) VALUES ($1,$2,1,'{}','approved')", [revisionId, ideaId])
    await db.query('INSERT INTO approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [ideaId, revisionId])
    await db.query("INSERT INTO media_previews(id,idea_id,revision_id,object_name,generation,content_type,published) VALUES ($1,$2,$3,$4,$5,'image/png',true)", [previewId, ideaId, revisionId, objectName, generation])
    const probe = createServer()
    await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
    const port = probe.address().port
    await new Promise(resolve => probe.close(resolve))
    const serverEnvironment = {
      ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DATABASE_URL: url,
      NUXT_APPROVED_MEDIA_BUCKET: bucketName, NUXT_PENDING_MEDIA_BUCKET: 'dallasurbanists-idea-map-dev-media-uploads',
      NUXT_MEDIA_PREVIEW_MAX_BYTES: '1048576', GOOGLE_CLOUD_PROJECT: 'dallasurbanists-idea-map-dev',
    }
    delete serverEnvironment.STORAGE_EMULATOR_HOST
    server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], { stdio: 'ignore', env: serverEnvironment })
    const base = `http://127.0.0.1:${port}`
    let ready = false
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error('web server exited during startup')
      try { await fetch(`${base}/api/health`); ready = true; break } catch { await delay(250) }
    }
    assert.ok(ready)
    const direct = await fetch(`https://storage.googleapis.com/${bucketName}/${objectName}`)
    assert.equal(direct.status, 403)
    const response = await fetch(`${base}/api/media/${previewId}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image)
    await db.query("UPDATE ideas SET publication_state='withdrawn' WHERE id=$1", [ideaId])
    assert.equal((await fetch(`${base}/api/media/${previewId}`)).status, 404)
  } finally {
    if (server) server.kill()
    try {
      if (connected) {
        try {
          await db.query('DELETE FROM media_previews WHERE id=$1', [previewId])
          await db.query('DELETE FROM approved_revisions WHERE idea_id=$1', [ideaId])
          await db.query('DELETE FROM idea_revisions WHERE id=$1', [revisionId])
          await db.query('DELETE FROM ideas WHERE id=$1', [ideaId])
          await db.query('DELETE FROM contacts WHERE id=$1', [contactId])
        } finally { await db.end() }
      }
    } finally {
      if (created && generation) {
        await exactGenerationFile(storage, bucketName, objectName, generation).delete({ ignoreNotFound: true })
      } else if (created) {
        console.error(`Test object retained because its generation is unknown: gs://${bucketName}/${objectName}`)
      }
    }
  }
})
