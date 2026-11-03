import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { after, test } from 'node:test'
import { writeRecoveryJournalRecord } from '../dist/recovery-journal-storage.js'

const target = { environment: 'dev', bucket: 'synthetic-private-backups' }
const id = '11111111-1111-4111-8111-111111111111'
const payload = Buffer.from('{"synthetic":"private record"}')
const originalEmulator = process.env.STORAGE_EMULATOR_HOST
delete process.env.STORAGE_EMULATOR_HOST
after(() => {
  if (originalEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
  else process.env.STORAGE_EMULATOR_HOST = originalEmulator
})

function fake(mode = 'success') {
  const seen = []
  const storage = { bucket(bucket) { return { file(path) { return { createWriteStream(options) {
    const entry = { bucket, path, options, bytes: [] }
    seen.push(entry)
    return new Writable({
      write(chunk, _encoding, callback) {
        entry.bytes.push(Buffer.from(chunk))
        if (mode === 'hang') return
        callback(mode === 'error' ? new Error('synthetic sensitive provider error') : undefined)
      },
    })
  } } } } } }
  return { storage, seen }
}

test('journal storage creates a bounded private record without exposing its contents in the name', async () => {
  const { storage, seen } = fake()
  await writeRecoveryJournalRecord(storage, target, id, payload)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].bucket, target.bucket)
  assert.equal(seen[0].path, `idea-map-v2/dev/recovery-journal/${id}.json`)
  assert.doesNotMatch(seen[0].path, /private record/)
  assert.equal(Buffer.concat(seen[0].bytes).toString(), payload.toString())
  assert.equal(seen[0].options.preconditionOpts.ifGenerationMatch, 0)
  assert.equal(seen[0].options.validation, 'crc32c')
  assert.equal(seen[0].options.resumable, false)
  assert.equal(seen[0].options.metadata.cacheControl, 'private, no-store')
})

test('journal storage treats provider errors and timeouts as uncertain without leaking details', async () => {
  for (const mode of ['error', 'hang']) {
    const { storage } = fake(mode)
    await assert.rejects(writeRecoveryJournalRecord(storage, target, id, payload, 20),
      error => error.message === 'Journal write outcome is uncertain' && !error.message.includes('sensitive'))
  }
})

test('journal storage rejects invalid destinations, IDs, bodies, and timeouts before writing', async () => {
  const { storage, seen } = fake()
  for (const [destination, recordId, body, timeout] of [
    [{ ...target, environment: 'prod-other' }, id, payload, 50],
    [{ ...target, bucket: 'gs://wrong' }, id, payload, 50],
    [{ ...target, bucket: { toString: () => target.bucket } }, id, payload, 50],
    [target, '../unsafe', payload, 50], [target, id, Buffer.from('not-json'), 50],
    [target, id, Buffer.from('[]'), 50], [target, id, Buffer.from([0xff]), 50],
    [target, id, Buffer.alloc(16_385), 50], [target, id, payload, 5001],
  ]) await assert.rejects(writeRecoveryJournalRecord(storage, destination, recordId, body, timeout), /Invalid journal record/)
  assert.equal(seen.length, 0)
})

test('journal storage refuses an environment-directed storage emulator', async () => {
  const previous = process.env.STORAGE_EMULATOR_HOST
  try {
    process.env.STORAGE_EMULATOR_HOST = ''
    await assert.rejects(writeRecoveryJournalRecord(fake().storage, target, id, payload), /Invalid journal record/)
  } finally {
    if (previous === undefined) delete process.env.STORAGE_EMULATOR_HOST
    else process.env.STORAGE_EMULATOR_HOST = previous
  }
})
