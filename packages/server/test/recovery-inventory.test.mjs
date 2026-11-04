import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { after, test } from 'node:test'
import { CRC32C } from '@google-cloud/storage'
import { encodeRecoveryIntent } from '../dist/recovery-journal-record.js'
import { prepareUnverifiedRecoveryInventory } from '../dist/recovery-inventory.js'

const target = { environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789' }
const id = '11111111-1111-4111-8111-111111111111'
const otherId = '44444444-4444-4444-8444-444444444444'
const intent = encodeRecoveryIntent({ operationId: id, environment: 'dev', ideaId: '22222222-2222-4222-8222-222222222222',
  actorId: '33333333-3333-4333-8333-333333333333', authorizedAt: '2026-11-03T12:00:00.000Z',
  decision: { kind: 'removal', classification: 'other', reason: 'synthetic private reason' } })
const prefix = 'idea-map-v2/dev/recovery-journal/'
const originalEmulator = process.env.STORAGE_EMULATOR_HOST
delete process.env.STORAGE_EMULATOR_HOST
after(() => {
  if (originalEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
  else process.env.STORAGE_EMULATOR_HOST = originalEmulator
})

function fake({ onSecondList, failRead = false, replaceDuringRead = false, streamBody } = {}) {
  const objects = new Map([[id, { body: Buffer.from(intent), generation: '90071992547409931234', metageneration: '1' }]])
  let versionLists = 0, bucketGeneration = '10'
  const storage = { bucket(bucket) { return {
    async getMetadata() { return [{ name: bucket, projectNumber: target.projectNumber, generation: bucketGeneration, metageneration: '1',
      iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
      versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }] },
    async getFiles(query) {
      if (query.softDeleted) return [[], null]
      if (++versionLists === 2) onSecondList?.(objects)
      return [[...objects].map(([recordId, object]) => {
        const crc = new CRC32C(); crc.update(object.body)
        return { metadata: { name: `${prefix}${recordId}.json`, bucket, generation: object.generation,
          metageneration: object.metageneration, size: String(object.body.length), contentType: 'application/json', crc32c: crc.toString() } }
      }), null]
    },
    file(name) {
      const file = { interceptors: [], createReadStream() {
        if (failRead) throw new Error('synthetic private provider failure')
        if (replaceDuringRead) bucketGeneration = '11'
        const object = objects.get(name.slice(prefix.length, -5))
        const request = file.interceptors[0].request({ uri: '/synthetic', qs: {} })
        if (!object || request.qs.generation !== object.generation || request.qs.ifGenerationMatch !== object.generation) {
          throw new Error('Synthetic generation mismatch')
        }
        const body = streamBody ?? object.body
        const crc = new CRC32C(); crc.update(body)
        const stream = Readable.from([body])
        process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: {
          'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': `crc32c=${crc.toString()}`,
        } }) }))
        return stream
      } }
      return file
    },
  } } }
  return storage
}

test('stable inventory reads exact generations but never claims coverage', async () => {
  const result = await prepareUnverifiedRecoveryInventory(fake(), target)
  assert.deepEqual(result.records, [intent])
  assert.equal(result.references[0].recordId, id)
  assert.equal(result.references[0].generation, '90071992547409931234')
  assert.equal(result.bucketGeneration, '10')
  assert.equal(result.bucketMetageneration, '1')
  assert.deepEqual(result.summary.removals, ['22222222-2222-4222-8222-222222222222'])
  assert.equal(result.summary.reviewOperations.length, 1)
  assert.equal(result.coverageVerified, false)
})

test('changed, missing, or added journal records fail the inventory', async () => {
  for (const onSecondList of [
    objects => { objects.get(id).metageneration = '2' },
    objects => { objects.delete(id) },
    objects => { objects.set(otherId, { ...objects.get(id), generation: '90071992547409931235' }) },
  ]) await assert.rejects(prepareUnverifiedRecoveryInventory(fake({ onSecondList }), target), /unavailable/)
  await assert.rejects(prepareUnverifiedRecoveryInventory(fake({ replaceDuringRead: true }), target), /unavailable/)
})

test('failed reads and expired deadlines fail without disclosing provider details', async t => {
  await assert.rejects(prepareUnverifiedRecoveryInventory(fake({ failRead: true }), target), error =>
    error.message === 'Recovery inventory unavailable' && !error.message.includes('private'))
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const storage = fake({ onSecondList() { now = 120_000 } })
  await assert.rejects(prepareUnverifiedRecoveryInventory(storage, target), /unavailable/)
  await assert.rejects(prepareUnverifiedRecoveryInventory(storage, target, 0), /Invalid/)
})

test('record bytes must match the checksum in the inventoried generation', async () => {
  const altered = encodeRecoveryIntent({ operationId: id, environment: 'dev', ideaId: '22222222-2222-4222-8222-222222222222',
    actorId: '33333333-3333-4333-8333-333333333333', authorizedAt: '2026-11-03T12:00:00.000Z',
    decision: { kind: 'removal', classification: 'other', reason: 'different synthetic reason' } })
  await assert.rejects(prepareUnverifiedRecoveryInventory(fake({ streamBody: altered }), target), /unavailable/)
})
