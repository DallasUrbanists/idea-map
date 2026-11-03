import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { readMediaPreview } from '../dist/media-preview.js'

function fixture(file) {
  let queries = 0
  const pool = { async query() { queries++; return { rows: [{ object_name: 'synthetic', generation: '1', content_type: 'image/png' }] } } }
  const storage = { bucket: () => ({ file: () => ({ ...file, interceptors: [] }) }) }
  return { pool, storage, queries: () => queries }
}

test('a disconnected preview does not reuse its database client after metadata returns', async () => {
  let resolveMetadata, markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const metadata = new Promise(resolve => { resolveMetadata = resolve })
  const fake = fixture({ getMetadata() { markStarted(); return metadata }, createReadStream() { throw new Error('Unexpected media read') } })
  const controller = new AbortController()
  const result = readMediaPreview(fake.pool, fake.storage, 'synthetic-private', 'synthetic', 1024, controller.signal)
  await started
  controller.abort()
  resolveMetadata([{ generation: '1', size: '8', contentType: 'image/png' }])
  await assert.rejects(result, /Preview unavailable/)
  assert.equal(fake.queries(), 1)
})

test('a disconnected preview aborts an in-flight media stream before rechecking the database', async () => {
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const stream = new Readable({ read() {} })
  const fake = fixture({ async getMetadata() { return [{ generation: '1', size: '8', contentType: 'image/png' }] },
    createReadStream() { markStarted(); return stream } })
  const controller = new AbortController()
  const result = readMediaPreview(fake.pool, fake.storage, 'synthetic-private', 'synthetic', 1024, controller.signal)
  await started
  controller.abort()
  await assert.rejects(result, /Preview unavailable/)
  assert.equal(stream.destroyed, true)
  assert.equal(fake.queries(), 1)
})
