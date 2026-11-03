import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { exportEncryptedBackup } from '../ops/export-encrypted-backup.mjs'
import { inspectBackupRetention } from '../ops/inspect-backup-retention.mjs'
import { writeRecoveryJournalRecord } from '../../../packages/server/dist/recovery-journal-storage.js'

const require = createRequire(import.meta.url)
const { Storage } = require('@google-cloud/storage')
const target = { environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789', databaseUrl: 'synthetic-only' }
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

test('storage client sends create-only archives, completion metadata, and journal records', async () => {
  const isolatedEnv = ['STORAGE_EMULATOR_HOST', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
  const previousEnv = new Map(isolatedEnv.map(key => [key, process.env[key]]))
  for (const key of isolatedEnv) delete process.env[key]
  const requests = []
  const objects = new Map()
  const payloads = new Map()
  const errors = []
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams) })
      if (request.headers.authorization) throw new Error('Synthetic endpoint must not receive credentials')
      response.setHeader('content-type', 'application/json')
      if (request.method === 'GET' && url.pathname === `/storage/v1/b/${target.bucket}`) {
        response.end(JSON.stringify({ name: target.bucket, projectNumber: target.projectNumber,
          iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
          versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }))
        return
      }
      if (request.method === 'GET' && url.pathname === `/storage/v1/b/${target.bucket}/o`) {
        response.end(JSON.stringify({ items: url.searchParams.get('softDeleted') === 'true' ? [] :
          [...objects.values()].filter(object => object.name.startsWith(url.searchParams.get('prefix'))) }))
        return
      }
      if (request.method !== 'POST' || url.pathname !== `/upload/storage/v1/b/${target.bucket}/o` ||
          url.searchParams.get('ifGenerationMatch') !== '0') throw new Error('Unexpected storage operation')
      const boundary = /boundary=([^;]+)/i.exec(request.headers['content-type'] ?? '')?.[1]?.replace(/^"|"$/g, '')
      if (!boundary) throw new Error('Missing multipart boundary')
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const parts = Buffer.concat(chunks).toString('utf8').split(`--${boundary}`)
      const section = part => {
        const offset = part.indexOf('\r\n\r\n')
        if (offset < 0 || !part.endsWith('\r\n')) throw new Error('Invalid multipart section')
        return part.slice(offset + 4, -2)
      }
      const sentMetadata = JSON.parse(section(parts[1]))
      const data = Buffer.from(section(parts[2]))
      const name = url.searchParams.get('name')
      if (!name) throw new Error('Unexpected object name')
      if (objects.has(name)) {
        response.statusCode = 412
        response.end(JSON.stringify({ error: { code: 412, message: 'Synthetic precondition failure' } }))
        return
      }
      const object = { name, bucket: target.bucket, generation: String(objects.size + 100), metageneration: '1',
        timeCreated: created, size: String(data.length), crc32c: crc32c(data), metadata: sentMetadata.metadata }
      objects.set(name, object)
      payloads.set(name, data)
      response.end(JSON.stringify(object))
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
    const start = () => {
      const stdout = Readable.from(['synthetic database bytes'])
      return { child: { stdout, kill() {} }, done: once(stdout, 'end') }
    }
    const exported = await exportEncryptedBackup(target, { storage, start, now: new Date('2026-11-02T10:00:00.000Z') })
    assert.equal(exported.objects.length, 2)
    for (const name of exported.objects) assert.equal(payloads.get(name).toString(), 'synthetic database bytes')
    const markers = [...objects.values()].filter(object => object.name.endsWith('.complete'))
    assert.equal(markers.length, 1)
    assert.equal(markers[0].size, '0')
    assert.equal(markers[0].metadata.daily_generation, objects.get(exported.objects[0]).generation)
    assert.equal(markers[0].metadata.weekly_generation, objects.get(exported.objects[1]).generation)
    objects.set('idea-map-v2/dev/recovery-journal/synthetic', { name: 'idea-map-v2/dev/recovery-journal/synthetic' })
    const inventory = await inspectBackupRetention(storage, target, new Date('2026-11-02T10:02:00.000Z'))
    assert.equal(inventory.retentionSatisfied, false)
    assert.deepEqual(inventory.groupCounts, { daily: 1, weekly: 1 })
    assert.deepEqual(inventory.candidates, [])
    assert.equal(inventory.latestDailyAgeSeconds, 120)
    const recordId = '11111111-1111-4111-8111-111111111111'
    const record = Buffer.from('{"synthetic":"private decision"}')
    await writeRecoveryJournalRecord(storage, target, recordId, record)
    const recordName = `idea-map-v2/dev/recovery-journal/${recordId}.json`
    assert.deepEqual(payloads.get(recordName), record)
    assert.equal(objects.get(recordName).metadata, undefined)
    await assert.rejects(writeRecoveryJournalRecord(storage, target, recordId, Buffer.from('{"synthetic":"different"}')),
      /Journal write outcome is uncertain/)
    assert.deepEqual(payloads.get(recordName), record)
    assert.equal(errors.length, 0)
    assert.equal(requests.filter(item => item.method === 'POST').length, 5)
    assert.deepEqual(new Set(requests.filter(item => item.path.endsWith('/o') && item.method === 'GET').map(item => item.query.prefix)),
      new Set(['daily', 'weekly', 'completion'].map(kind => `idea-map-v2/dev/${kind}/`)))
    assert.ok(requests.every(item => ['GET', 'POST'].includes(item.method)))
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
