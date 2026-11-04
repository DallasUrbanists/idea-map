import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { after, test } from 'node:test'
import { CRC32C } from '@google-cloud/storage'
import { readUnverifiedHeldMaterial, writeUnverifiedHeldMaterial } from '../dist/recovery-journal-storage.js'

const target = { environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789' }
const artifact = '11111111-1111-4111-8111-111111111111'
const contents = Buffer.from('synthetic private held material')
const originalEmulator = process.env.STORAGE_EMULATOR_HOST
delete process.env.STORAGE_EMULATOR_HOST
after(() => {
  if (originalEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
  else process.env.STORAGE_EMULATOR_HOST = originalEmulator
})

function fake({ wrongChecksum = false, missingHeader = false, failWrite = false } = {}) {
  const objects = new Map()
  const storage = { bucket(name) { return {
    async getMetadata() { return [{ name, projectNumber: target.projectNumber,
      iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
      versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }] },
    file(path) {
      const file = { interceptors: [], createWriteStream(options) {
        assert.equal(options.preconditionOpts.ifGenerationMatch, 0)
        assert.equal(options.validation, 'crc32c')
        assert.equal(options.metadata.cacheControl, 'private, no-store')
        const chunks = []
        return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
          final(callback) {
            if (failWrite || objects.has(path)) return callback(new Error('synthetic private provider failure'))
            const body = Buffer.concat(chunks), crc = new CRC32C()
            crc.update(body)
            file.metadata = { name: path, generation: '90071992547409931234', size: String(body.length),
              crc32c: wrongChecksum ? 'AAAAAA==' : crc.toString() }
            objects.set(path, { body, metadata: file.metadata })
            callback()
          } })
      }, createReadStream() {
        const object = objects.get(path)
        const request = file.interceptors[0].request({ uri: '/synthetic', qs: {} })
        if (!object || request.qs.generation !== object.metadata.generation || request.qs.ifGenerationMatch !== object.metadata.generation) {
          throw new Error('synthetic private generation failure')
        }
        const stream = Readable.from([object.body])
        process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: missingHeader ? {} : {
          'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': `crc32c=${object.metadata.crc32c}`,
        } }) }))
        return stream
      } }
      return file
    },
  } } }
  return { storage, objects }
}

test('private held material is create-only and read by exact generation and digest', async () => {
  const { storage } = fake()
  const saved = await writeUnverifiedHeldMaterial(storage, target, artifact, contents)
  assert.deepEqual(saved, { generation: '90071992547409931234', size: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'), coverageVerified: false })
  assert.deepEqual(Buffer.from(await readUnverifiedHeldMaterial(storage, target, artifact, saved)), contents)
  await assert.rejects(writeUnverifiedHeldMaterial(storage, target, artifact, contents), /outcome is uncertain/)
  await assert.rejects(readUnverifiedHeldMaterial(storage, target, artifact, { ...saved, sha256: '0'.repeat(64) }), /could not be verified/)
  await assert.rejects(readUnverifiedHeldMaterial(storage, target, artifact, { ...saved, generation: '1' }), /could not be verified/)
})

test('ambiguous writes, missing checksums, and invalid inputs fail closed without content', async () => {
  await assert.rejects(writeUnverifiedHeldMaterial(fake({ wrongChecksum: true }).storage, target, artifact, contents),
    error => error.message === 'Held material write outcome is uncertain' && !error.message.includes('private'))
  await assert.rejects(writeUnverifiedHeldMaterial(fake({ failWrite: true }).storage, target, artifact, contents), /outcome is uncertain/)
  const { storage } = fake({ missingHeader: true })
  const saved = await writeUnverifiedHeldMaterial(storage, target, artifact, contents)
  await assert.rejects(readUnverifiedHeldMaterial(storage, target, artifact, saved), /could not be verified/)
  await assert.rejects(writeUnverifiedHeldMaterial(storage, target, artifact, Buffer.alloc(0)), /Invalid/)
  await assert.rejects(writeUnverifiedHeldMaterial(storage, target, artifact, Buffer.alloc(16 * 1024 * 1024 + 1)), /Invalid/)
  await assert.rejects(readUnverifiedHeldMaterial(storage, target, artifact, { ...saved, size: 0 }), /Invalid/)
})

test('the selected bytes and reference cannot change while storage is pending', async () => {
  const { storage } = fake()
  const mutable = Buffer.from(contents)
  const pendingWrite = writeUnverifiedHeldMaterial(storage, target, artifact, mutable)
  mutable.fill(0)
  const saved = await pendingWrite
  const reference = { ...saved }
  const pendingRead = readUnverifiedHeldMaterial(storage, target, artifact, reference)
  reference.sha256 = '0'.repeat(64)
  reference.size = 1
  assert.deepEqual(Buffer.from(await pendingRead), contents)
})
