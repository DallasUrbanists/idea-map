import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { exportEncryptedBackup } from '../ops/export-encrypted-backup.mjs'
import { inspectBackupRetention } from '../ops/inspect-backup-retention.mjs'
import { readUnverifiedHeldMaterial, writeUnverifiedHeldMaterial } from '../../../packages/server/dist/recovery-held-storage.js'

const require = createRequire(import.meta.url)
const { Storage } = require('@google-cloud/storage')
const target = { environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789',
  databaseUrl: 'postgres://synthetic:synthetic@example.invalid/db?sslmode=verify-full&sslrootcert=system' }
const created = '2026-11-02T10:01:00.000Z'

// Independent checksum for the fake server's synthetic bytes.
function crc32c(data) {
  let value = 0xffffffff
  for (const byte of data) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0x82f63b78 : 0)
  }
  const result = Buffer.alloc(4)
  result.writeUInt32BE((value ^ 0xffffffff) >>> 0)
  return result.toString('base64')
}

test('storage client sends create-only archives, completion metadata, and held material', async () => {
  const isolatedEnv = ['STORAGE_EMULATOR_HOST', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
  const previousEnv = new Map(isolatedEnv.map(key => [key, process.env[key]]))
  for (const key of isolatedEnv) delete process.env[key]
  const requests = []
  const objects = new Map()
  const payloads = new Map()
  const errors = []
  let omitStoredEncoding = false
  let changeHoldDuringRead = false
  let corruptArchiveResponse = false
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams) })
      if (request.headers.authorization) throw new Error('Synthetic endpoint must not receive credentials')
      response.setHeader('content-type', 'application/json')
      if (request.method === 'DELETE' && corruptArchiveResponse && url.pathname.startsWith(`/storage/v1/b/${target.bucket}/o/`)) {
        response.statusCode = 403
        response.end(JSON.stringify({ error: { code: 403, message: 'Synthetic create-only writer' } }))
        return
      }
      if (request.method === 'GET' && url.pathname === `/storage/v1/b/${target.bucket}`) {
        response.end(JSON.stringify({ name: target.bucket, projectNumber: target.projectNumber, generation: '11', metageneration: '1',
          iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
          versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }))
        return
      }
      if (request.method === 'GET' && url.pathname === `/storage/v1/b/${target.bucket}/o`) {
        const prefix = url.searchParams.get('prefix')
        const items = url.searchParams.get('softDeleted') === 'true' ? [] : [...objects.values()].filter(object => object.name.startsWith(prefix))
        response.end(JSON.stringify({ items }))
        return
      }
      if (request.method === 'GET' && url.pathname.startsWith(`/storage/v1/b/${target.bucket}/o/`) && url.searchParams.get('alt') === 'media') {
        const name = decodeURIComponent(url.pathname.slice(`/storage/v1/b/${target.bucket}/o/`.length))
        const object = objects.get(name)
        if (!object || url.searchParams.get('generation') !== object.generation || url.searchParams.get('ifGenerationMatch') !== object.generation) throw new Error('Unexpected journal generation')
        const data = payloads.get(name)
        response.setHeader('content-type', 'application/octet-stream')
        response.setHeader('content-length', data.length)
        if (!omitStoredEncoding) response.setHeader('x-goog-stored-content-encoding', 'identity')
        response.setHeader('x-goog-hash', `crc32c=${object.crc32c}`)
        if (changeHoldDuringRead) { object.temporaryHold = false; object.metageneration = '2' }
        response.end(data)
        return
      }
      if (request.method === 'GET' && url.pathname.startsWith(`/storage/v1/b/${target.bucket}/o/`)) {
        const name = decodeURIComponent(url.pathname.slice(`/storage/v1/b/${target.bucket}/o/`.length))
        const object = objects.get(name)
        if (!object || url.searchParams.get('generation') !== object.generation ||
            url.searchParams.get('ifGenerationMatch') !== object.generation) throw new Error('Missing synthetic object')
        response.end(JSON.stringify(object))
        return
      }
      if (request.method !== 'POST' || url.pathname !== `/upload/storage/v1/b/${target.bucket}/o` ||
          url.searchParams.get('ifGenerationMatch') !== '0') throw new Error('Unexpected storage operation')
      const boundary = /boundary=([^;]+)/i.exec(request.headers['content-type'] ?? '')?.[1]?.replace(/^"|"$/g, '')
      if (!boundary) throw new Error('Missing multipart boundary')
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      const delimiter = Buffer.from(`--${boundary}`)
      const separator = Buffer.from('\r\n\r\n')
      const section = start => {
        const next = body.indexOf(delimiter, start + delimiter.length)
        const headersEnd = body.indexOf(separator, start + delimiter.length)
        if (next < 0 || headersEnd < 0 || headersEnd >= next ||
            body.subarray(next - 2, next).toString('ascii') !== '\r\n') throw new Error('Invalid multipart section')
        return { data: body.subarray(headersEnd + separator.length, next - 2), next }
      }
      if (body.indexOf(delimiter) !== 0) throw new Error('Invalid multipart boundary')
      const metadataPart = section(0)
      const dataPart = section(metadataPart.next)
      const sentMetadata = JSON.parse(metadataPart.data.toString('utf8'))
      const data = dataPart.data
      const name = url.searchParams.get('name')
      if (!name) throw new Error('Unexpected object name')
      if (objects.has(name)) {
        response.statusCode = 412
        response.end(JSON.stringify({ error: { code: 412, message: 'Synthetic precondition failure' } }))
        return
      }
      const object = { name, bucket: target.bucket, generation: String(objects.size + 100), metageneration: '1',
        timeCreated: created, size: String(data.length), crc32c: crc32c(data),
        contentType: sentMetadata.contentType, metadata: sentMetadata.metadata, temporaryHold: sentMetadata.temporaryHold }
      objects.set(name, object)
      payloads.set(name, data)
      response.end(JSON.stringify(corruptArchiveResponse && name.endsWith('.pgdump') ? { ...object, crc32c: 'AAAAAA==' } : object))
    } catch (error) {
      errors.push(error.message)
      response.statusCode = 500
      response.end('{}')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const port = server.address().port
    const storage = new Storage({ projectId: 'synthetic', apiEndpoint: `http://127.0.0.1:${port}`, useAuthWithCustomEndpoint: false, retryOptions: { autoRetry: false } })
    const syntheticArchive = Buffer.from([0x50, 0x47, 0x44, 0x4d, 0x50, 0x00, 0x80, 0xff, 0x0d, 0x0a, 0xc3, 0x28])
    const start = () => {
      const stdout = Readable.from([syntheticArchive])
      return { child: { stdout, kill() {} }, done: once(stdout, 'end') }
    }
    const exported = await exportEncryptedBackup(target, { storage, start, now: new Date('2026-11-02T10:00:00.000Z') })
    assert.equal(exported.objects.length, 2)
    for (const name of exported.objects) {
      assert.deepEqual(payloads.get(name), syntheticArchive)
      assert.equal(objects.get(name).temporaryHold, undefined)
    }
    const markers = [...objects.values()].filter(object => object.name.endsWith('.complete'))
    assert.equal(markers.length, 1)
    assert.equal(markers[0].size, '0')
    assert.equal(markers[0].temporaryHold, undefined)
    assert.equal(markers[0].metadata.daily_generation, objects.get(exported.objects[0]).generation)
    assert.equal(markers[0].metadata.weekly_generation, objects.get(exported.objects[1]).generation)
    objects.set('idea-map-v2/dev/held-material/synthetic', { name: 'idea-map-v2/dev/held-material/synthetic' })
    const inventory = await inspectBackupRetention(storage, target, new Date('2026-11-02T10:02:00.000Z'))
    assert.equal(inventory.retentionSatisfied, false)
    assert.deepEqual(inventory.groupCounts, { daily: 1, weekly: 1 })
    assert.deepEqual(inventory.candidates, [])
    assert.equal(inventory.latestDailyAgeSeconds, 120)
    assert.deepEqual(new Set(requests.filter(item => item.path.endsWith('/o') && item.method === 'GET').map(item => item.query.prefix)),
      new Set(['daily', 'weekly', 'completion'].map(kind => `idea-map-v2/dev/${kind}/`)))
    objects.delete('idea-map-v2/dev/held-material/synthetic')
    const heldId = '77777777-7777-4777-8777-777777777777'
    const heldBytes = Buffer.from('synthetic held material')
    const held = await writeUnverifiedHeldMaterial(storage, target, heldId, heldBytes)
    const heldName = `idea-map-v2/dev/held-material/${heldId}.bin`
    assert.equal(held.coverageVerified, false)
    assert.deepEqual(Buffer.from(await readUnverifiedHeldMaterial(storage, target, heldId, held)), heldBytes)
    changeHoldDuringRead = true
    await assert.rejects(readUnverifiedHeldMaterial(storage, target, heldId, held), /could not be verified/)
    changeHoldDuringRead = false
    objects.get(heldName).temporaryHold = true
    omitStoredEncoding = true
    await assert.rejects(readUnverifiedHeldMaterial(storage, target, heldId, held), /could not be verified/)
    omitStoredEncoding = false
    await assert.rejects(writeUnverifiedHeldMaterial(storage, target, heldId, heldBytes), /outcome is uncertain/)
    assert.equal(objects.get(heldName).metadata, undefined)
    assert.equal(objects.get(heldName).temporaryHold, true)
    assert.equal(errors.length, 0)
    assert.equal(requests.filter(item => item.method === 'POST').length, 5)
    assert.deepEqual(new Set(requests.filter(item => item.path.endsWith('/o') && item.method === 'GET').map(item => item.query.prefix)),
      new Set(['daily', 'weekly', 'completion'].map(kind => `idea-map-v2/dev/${kind}/`)))
    assert.ok(requests.every(item => ['GET', 'POST'].includes(item.method)))
    corruptArchiveResponse = true
    await assert.rejects(exportEncryptedBackup(target, { storage, start, now: new Date('2026-11-03T10:00:00.000Z') }))
    assert.equal(requests.filter(item => item.method === 'DELETE').length, 1)
    assert.equal([...objects.values()].filter(object => object.name.endsWith('.complete')).length, 1)
    assert.equal([...objects.values()].filter(object => object.name.includes('/daily/')).length, 2)
    assert.equal(errors.length, 0)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
