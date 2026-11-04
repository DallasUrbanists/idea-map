import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { after, test } from 'node:test'
import { CRC32C } from '@google-cloud/storage'
import { compareCurrentRecoveryJournalRecord, listUnverifiedRecoveryJournal, readRecoveryJournalRecord, writeRecoveryJournalRecord } from '../dist/recovery-journal-storage.js'
import { encodeRecoveryConfirmation, encodeRecoveryIntent, recoveryConfirmationRecordId } from '../dist/recovery-journal-record.js'

const target = { environment: 'dev', bucket: 'synthetic-private-backups' }
const id = '11111111-1111-4111-8111-111111111111'
const payload = encodeRecoveryConfirmation(id, 'dev', '2026-11-03T12:00:00.000Z')
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
  assert.doesNotMatch(seen[0].path, /commit_confirmation/)
  assert.equal(Buffer.concat(seen[0].bytes).toString(), payload.toString())
  assert.equal(seen[0].options.preconditionOpts.ifGenerationMatch, 0)
  assert.equal(seen[0].options.validation, 'crc32c')
  assert.equal(seen[0].options.resumable, false)
  assert.equal(seen[0].options.metadata.cacheControl, 'private, no-store')
})

test('journal storage accepts the deterministic confirmation record ID', async () => {
  const { storage, seen } = fake()
  const confirmationId = recoveryConfirmationRecordId(id)
  await writeRecoveryJournalRecord(storage, target, confirmationId, encodeRecoveryConfirmation(id, 'dev', '2026-11-03T12:00:00.000Z'))
  assert.equal(seen[0].path, `idea-map-v2/dev/recovery-journal/${confirmationId}.json`)
  assert.equal(seen[0].options.preconditionOpts.ifGenerationMatch, 0)
  const differentId = recoveryConfirmationRecordId('22222222-2222-4222-8222-222222222222')
  await assert.rejects(writeRecoveryJournalRecord(storage, target, differentId,
    encodeRecoveryConfirmation(id, 'dev', '2026-11-03T12:00:00.000Z')), /Invalid journal record/)
  const intent = encodeRecoveryIntent({ operationId: id, environment: 'dev', ideaId: id, actorId: id,
    authorizedAt: '2026-11-03T12:00:00.000Z', decision: { kind: 'removal', classification: 'other', reason: 'synthetic' } })
  await assert.rejects(writeRecoveryJournalRecord(storage, target, confirmationId, intent), /Invalid journal record/)
  assert.equal(seen.length, 1)
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
    [target, id, Buffer.from('{"synthetic":"unsupported"}'), 50],
    [target, id, encodeRecoveryConfirmation(id, 'prod', '2026-11-03T12:00:00.000Z'), 50],
    [target, id, Buffer.concat([Buffer.from(' '), payload]), 50],
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

test('journal reader selects an exact generation and validates bounded canonical bytes', async () => {
  const body = encodeRecoveryConfirmation(id, 'dev', '2026-11-03T12:00:00.000Z')
  const entries = []
  const storage = { bucket(bucket) { return { file(path, options) {
    const file = { interceptors: [], createReadStream(readOptions) {
      entries.push({ bucket, path, options, readOptions, request: file.interceptors[0].request({ uri: '/synthetic', qs: {} }) })
      const stream = Readable.from([body])
      process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: {
        'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': 'crc32c=AAAAAA==',
      } }) }))
      return stream
    } }
    return file
  } } } }
  const generation = '90071992547409931234'
  assert.deepEqual(await readRecoveryJournalRecord(storage, target, id, generation), body)
  assert.equal(entries[0].path, `idea-map-v2/dev/recovery-journal/${id}.json`)
  assert.equal(entries[0].request.qs.generation, generation)
  assert.equal(entries[0].request.qs.ifGenerationMatch, generation)
  assert.equal(entries[0].readOptions.validation, 'crc32c')
  assert.equal(entries[0].readOptions.decompress, false)
})

test('journal reader fails closed on invalid references, records, provider errors, and timeouts', async () => {
  const storage = (chunks, withHeaders = true) => ({ bucket: () => ({ file: () => ({ interceptors: [], createReadStream: () => {
    const stream = Readable.from(chunks)
    if (withHeaders) process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: {
      'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': 'crc32c=AAAAAA==',
    } }) }))
    return stream
  } }) }) })
  await assert.rejects(readRecoveryJournalRecord(storage([]), target, id, '0'), /Invalid journal record reference/)
  await assert.rejects(readRecoveryJournalRecord(storage([]), target, id, 42), /Invalid journal record reference/)
  for (const chunks of [[Buffer.alloc(16_385)], [Buffer.from('{"private":"incompatible"}')],
    [encodeRecoveryConfirmation(id, 'prod', '2026-11-03T12:00:00.000Z')]]) {
    await assert.rejects(readRecoveryJournalRecord(storage(chunks), target, id, '1'), /could not be verified/)
  }
  await assert.rejects(readRecoveryJournalRecord(storage([encodeRecoveryConfirmation(id, 'dev', '2026-11-03T12:00:00.000Z')], false), target, id, '1'), /could not be verified/)
  const wrongConfirmationId = recoveryConfirmationRecordId('22222222-2222-4222-8222-222222222222')
  await assert.rejects(readRecoveryJournalRecord(storage([encodeRecoveryConfirmation(id, 'dev', '2026-11-03T12:00:00.000Z')]),
    target, wrongConfirmationId, '1'), /could not be verified/)
  const failing = { bucket: () => ({ file: () => ({ interceptors: [], createReadStream: () =>
    new Readable({ read() { this.destroy(new Error('synthetic sensitive provider error')) } }) }) }) }
  await assert.rejects(readRecoveryJournalRecord(failing, target, id, '1'), error =>
    error.message === 'Journal record could not be verified' && !error.message.includes('sensitive'))
  const hanging = { bucket: () => ({ file: () => ({ interceptors: [], createReadStream: () => new Readable({ read() {} }) }) }) }
  await assert.rejects(readRecoveryJournalRecord(hanging, target, id, '1', 20), /could not be verified/)
})

test('ambiguous write readback requires the same current generation and exact saved bytes', async () => {
  const body = encodeRecoveryConfirmation(id, 'dev', '2026-11-03T12:00:00.000Z')
  const generation = '90071992547409931234'
  const path = `idea-map-v2/dev/recovery-journal/${id}.json`
  const checksum = new CRC32C()
  checksum.update(body)
  const base = { bucket: target.bucket, name: path, generation, metageneration: '1',
    size: String(body.length), contentType: 'application/json', crc32c: checksum.toString() }
  function storageFor({ metadata = [base, base], stored = body, hang = false } = {}) {
    let calls = 0
    return { bucket: () => ({ file: () => ({ interceptors: [],
      getMetadata: () => hang ? new Promise(() => {}) : Promise.resolve([metadata[calls++]]),
      createReadStream: () => {
        const stream = Readable.from([stored])
        process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: {
          'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': 'crc32c=AAAAAA==',
        } }) }))
        return stream
      },
    }) }) }
  }
  assert.deepEqual(await compareCurrentRecoveryJournalRecord(storageFor(), target, id, body),
    { generation, coverageVerified: false })
  const other = encodeRecoveryConfirmation(id, 'dev', '2026-11-03T12:00:01.000Z')
  for (const storage of [
    storageFor({ stored: other }),
    storageFor({ metadata: [base, { ...base, generation: '2' }] }),
    storageFor({ metadata: [base, { ...base, metageneration: '2' }] }),
    storageFor({ metadata: [{ ...base, bucket: 'wrong-bucket' }] }),
    storageFor({ metadata: [{ ...base, crc32c: undefined }] }),
    storageFor({ metadata: [{ ...base, crc32c: checksum.toString() === 'AAAAAA==' ? 'AQAAAA==' : 'AAAAAA==' }] }),
    storageFor({ metadata: [{ ...base, timeDeleted: '2026-11-03T12:00:00.000Z' }] }),
    storageFor({ hang: true }),
  ]) await assert.rejects(compareCurrentRecoveryJournalRecord(storage, target, id, body, 20),
    error => error.message === 'Journal record could not be verified')
})

test('journal inventory discovers bounded exact generations without asserting coverage', async () => {
  const secondId = recoveryConfirmationRecordId(id)
  const prefix = 'idea-map-v2/dev/recovery-journal/'
  const metadata = recordId => ({ name: `${prefix}${recordId}.json`, bucket: target.bucket,
    generation: '90071992547409931234', metageneration: '1', size: '123', contentType: 'application/json', crc32c: 'AAAAAA==' })
  const queries = []
  const storageFor = pages => ({ bucket: () => ({ async getFiles(query) {
    queries.push(query)
    const result = pages.shift()
    if (result instanceof Error) throw result
    return result
  } }) })
  const first = { metadata: metadata(id) }
  const second = { metadata: metadata(secondId) }
  const result = await listUnverifiedRecoveryJournal(storageFor([
    [[first], { pageToken: 'next', prefix: 'untrusted' }], [[second], null],
    [[], { pageToken: 'soft-next' }], [[], null],
  ]), target)
  assert.deepEqual(result, { references: [{ recordId: id, generation: first.metadata.generation },
    { recordId: secondId, generation: second.metadata.generation }], coverageVerified: false, softDeletedChecked: true })
  assert.equal(queries.length, 4)
  assert.ok(queries.every(query => query.prefix === prefix && query.autoPaginate === false))
  assert.ok(queries.slice(0, 2).every(query => query.versions === true && !query.softDeleted))
  assert.ok(queries.slice(2).every(query => query.softDeleted === true && !query.versions))
  assert.equal(queries[1].pageToken, 'next')
  assert.equal(queries[3].pageToken, 'soft-next')

  const malformed = [
    { ...first.metadata, name: `${prefix}../private.json` },
    { ...first.metadata, bucket: 'wrong-bucket' },
    { ...first.metadata, generation: 4 },
    { ...first.metadata, timeDeleted: '2026-11-03T12:00:00.000Z' },
    { ...first.metadata, size: '16385' },
    { ...first.metadata, crc32c: undefined },
  ]
  for (const value of malformed) await assert.rejects(listUnverifiedRecoveryJournal(storageFor([[[{ metadata: value }], null]]), target), /could not be verified/)
  await assert.rejects(listUnverifiedRecoveryJournal(storageFor([[[first, first], null]]), target), /could not be verified/)
  await assert.rejects(listUnverifiedRecoveryJournal(storageFor([[[first], null], [[second], null]]), target), /could not be verified/)
  await assert.rejects(listUnverifiedRecoveryJournal(storageFor([[[first], null], new Error('synthetic soft-deleted listing error')]), target), /could not be verified/)
  await assert.rejects(listUnverifiedRecoveryJournal(storageFor([[[first], null], [[], { pageToken: 'repeat' }], [[], { pageToken: 'repeat' }]]), target), /could not be verified/)
  await assert.rejects(listUnverifiedRecoveryJournal(storageFor([[[], { pageToken: 'repeat' }], [[], { pageToken: 'repeat' }]]), target), /could not be verified/)
  await assert.rejects(listUnverifiedRecoveryJournal(storageFor([new Error('synthetic sensitive provider error')]), target), error =>
    error.message === 'Journal inventory could not be verified' && !error.message.includes('sensitive'))
})

test('journal inventory fails closed when listing does not respond', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const storage = { bucket: () => ({ getFiles: () => new Promise(() => {}) }) }
  const rejected = assert.rejects(listUnverifiedRecoveryJournal(storage, target), /could not be verified/)
  t.mock.timers.tick(5000)
  await rejected
})
