import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { after, test } from 'node:test'
import { CRC32C } from '@google-cloud/storage'
import { readUnverifiedHeldMaterial, writeUnverifiedHeldMaterial } from '../dist/recovery-held-storage.js'
import { encodeUnverifiedHeldManifest } from '../dist/recovery-held-manifest.js'
import { encodeRecoveryHoldManifestConfirmation, encodeRecoveryIntent, recoveryConfirmationRecordId } from '../dist/recovery-journal-record.js'
import { encodeRecoverySequenceEntry } from '../dist/recovery-sequence.js'
import { unverifiedRolloverCheckpoint } from '../dist/recovery-sequence-rollover.js'
import { verifyRolloverHeldCaptures, verifySequenceChainHeldCaptures, verifySequenceHeldCaptures, verifyUnverifiedHeldCapture, verifyUnverifiedHeldCaptureAgainstSources } from '../dist/recovery-held-verification.js'

const target = { environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789' }
const artifact = '11111111-1111-4111-8111-111111111111'
const contents = Buffer.from('synthetic private held material')
const originalEmulator = process.env.STORAGE_EMULATOR_HOST
delete process.env.STORAGE_EMULATOR_HOST
after(() => {
  if (originalEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
  else process.env.STORAGE_EMULATOR_HOST = originalEmulator
})

function fake({ wrongChecksum = false, wrongBucket = false, missingMetageneration = false, missingHeader = false, failWrite = false, missingHold = false, changeHoldDuringRead = false, stallMetadata = false, delayStreamEnd = false, changeBucketAt = 0, changeBucketGeneration = false, missingBucketGeneration = false, softDelete = '604800' } = {}) {
  const objects = new Map()
  let reads = 0
  let metadataReads = 0
  let bucketReads = 0
  const storage = { bucket(name) { return {
    async getMetadata() { bucketReads++; return [{ name, projectNumber: target.projectNumber,
      generation: missingBucketGeneration ? undefined : changeBucketGeneration && changeBucketAt && bucketReads >= changeBucketAt ? '12' : '11',
      metageneration: !changeBucketGeneration && changeBucketAt && bucketReads >= changeBucketAt ? '2' : '1',
      iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
      versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: softDelete } }] },
    file(path) {
      const file = { interceptors: [], createWriteStream(options) {
        assert.equal(options.preconditionOpts.ifGenerationMatch, 0)
        assert.equal(options.validation, 'crc32c')
        assert.equal(options.metadata.cacheControl, 'private, no-store')
        assert.equal(options.metadata.temporaryHold, true)
        const chunks = []
        return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
          final(callback) {
            if (failWrite || objects.has(path)) return callback(new Error('synthetic private provider failure'))
            const body = Buffer.concat(chunks), crc = new CRC32C()
            crc.update(body)
            file.metadata = { name: path, bucket: wrongBucket ? 'synthetic-wrong-bucket' : name, generation: '90071992547409931234',
              metageneration: missingMetageneration ? undefined : '1', size: String(body.length),
              crc32c: wrongChecksum ? 'AAAAAA==' : crc.toString(), temporaryHold: !missingHold }
            objects.set(path, { body, metadata: file.metadata })
            callback()
          } })
      }, async getMetadata() {
        metadataReads++
        if (stallMetadata) return new Promise(() => {})
        const object = objects.get(path)
        const request = file.interceptors[0].request({ uri: '/synthetic', qs: {} })
        if (!object || request.qs.generation !== object.metadata.generation || request.qs.ifGenerationMatch !== object.metadata.generation) {
          throw new Error('synthetic private generation failure')
        }
        return [{ ...object.metadata }]
      }, createReadStream() {
        reads++
        const object = objects.get(path)
        const request = file.interceptors[0].request({ uri: '/synthetic', qs: {} })
        if (!object || request.qs.generation !== object.metadata.generation || request.qs.ifGenerationMatch !== object.metadata.generation) {
          throw new Error('synthetic private generation failure')
        }
        const stream = Readable.from([object.body])
        if (changeHoldDuringRead) stream.once('end', () => { object.metadata.metageneration = '2' })
        if (delayStreamEnd) stream.once('end', () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400) })
        process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: missingHeader ? {} : {
          'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': `crc32c=${object.metadata.crc32c}`,
        } }) }))
        return stream
      } }
      return file
    },
  } } }
  return { storage, objects, reads: () => reads, metadataReads: () => metadataReads }
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
  await assert.rejects(writeUnverifiedHeldMaterial(fake({ wrongBucket: true }).storage, target, artifact, contents), /outcome is uncertain/)
  await assert.rejects(writeUnverifiedHeldMaterial(fake({ missingMetageneration: true }).storage, target, artifact, contents), /outcome is uncertain/)
  const missingBucket = fake({ missingBucketGeneration: true })
  await assert.rejects(writeUnverifiedHeldMaterial(missingBucket.storage, target, artifact, contents), /outcome is uncertain/)
  assert.equal(missingBucket.objects.size, 0)
  for (const changeBucketGeneration of [false, true]) {
    const changedAfterWrite = fake({ changeBucketAt: 2, changeBucketGeneration })
    await assert.rejects(writeUnverifiedHeldMaterial(changedAfterWrite.storage, target, artifact, contents), /outcome is uncertain/)
    assert.equal(changedAfterWrite.objects.size, 1) // The held object can exist despite the uncertain result.
    assert.equal([...changedAfterWrite.objects.values()][0].metadata.temporaryHold, true)
  }
  await assert.rejects(writeUnverifiedHeldMaterial(fake({ failWrite: true }).storage, target, artifact, contents), /outcome is uncertain/)
  await assert.rejects(writeUnverifiedHeldMaterial(fake({ missingHold: true }).storage, target, artifact, contents), /outcome is uncertain/)
  const disabled = fake({ softDelete: '0' })
  await assert.rejects(writeUnverifiedHeldMaterial(disabled.storage, target, artifact, contents), /outcome is uncertain/)
  assert.equal(disabled.objects.size, 0)
  const { storage } = fake({ missingHeader: true })
  const saved = await writeUnverifiedHeldMaterial(storage, target, artifact, contents)
  await assert.rejects(readUnverifiedHeldMaterial(storage, target, artifact, saved), /could not be verified/)
  await assert.rejects(writeUnverifiedHeldMaterial(storage, target, artifact, Buffer.alloc(0)), /Invalid/)
  await assert.rejects(writeUnverifiedHeldMaterial(storage, target, artifact, Buffer.alloc(16 * 1024 * 1024 + 1)), /Invalid/)
  await assert.rejects(readUnverifiedHeldMaterial(storage, target, artifact, { ...saved, size: 0 }), /Invalid/)
  const changing = fake({ changeHoldDuringRead: true })
  const changingSaved = await writeUnverifiedHeldMaterial(changing.storage, target, artifact, contents)
  await assert.rejects(readUnverifiedHeldMaterial(changing.storage, target, artifact, changingSaved), /could not be verified/)
  const missing = fake()
  const missingSaved = await writeUnverifiedHeldMaterial(missing.storage, target, artifact, contents)
  missing.objects.get(`idea-map-v2/dev/held-material/${artifact}.bin`).metadata.temporaryHold = false
  await assert.rejects(readUnverifiedHeldMaterial(missing.storage, target, artifact, missingSaved), /could not be verified/)
  for (const changeBucketGeneration of [false, true]) {
    const changedDuringRead = fake({ changeBucketAt: 4, changeBucketGeneration })
    const changedSaved = await writeUnverifiedHeldMaterial(changedDuringRead.storage, target, artifact, contents)
    await assert.rejects(readUnverifiedHeldMaterial(changedDuringRead.storage, target, artifact, changedSaved), /could not be verified/)
  }
  const stalled = fake({ stallMetadata: true })
  const stalledSaved = await writeUnverifiedHeldMaterial(stalled.storage, target, artifact, contents)
  await assert.rejects(readUnverifiedHeldMaterial(stalled.storage, target, artifact, stalledSaved, 20), /could not be verified/)
  const delayed = fake({ delayStreamEnd: true })
  const delayedSaved = await writeUnverifiedHeldMaterial(delayed.storage, target, artifact, contents)
  await assert.rejects(readUnverifiedHeldMaterial(delayed.storage, target, artifact, delayedSaved, 250), /could not be verified/)
  assert.equal(delayed.metadataReads(), 1) // Do not start a new provider request after the deadline.
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

test('verification reads every selected generation but never asserts hold coverage', async () => {
  const { storage, objects, reads } = fake()
  const operationId = '22222222-2222-4222-8222-222222222222', ideaId = '33333333-3333-4333-8333-333333333333'
  const holdId = '44444444-4444-4444-8444-444444444444', actorId = '55555555-5555-4555-8555-555555555555'
  const manifestId = '66666666-6666-4666-8666-666666666666', mediaId = '77777777-7777-4777-8777-777777777777'
  const saved = await writeUnverifiedHeldMaterial(storage, target, artifact, contents)
  const secondId = '99999999-9999-4999-8999-999999999999', secondBytes = Buffer.from('synthetic media')
  const second = await writeUnverifiedHeldMaterial(storage, target, secondId, secondBytes)
  const entry = { kind: 'revision', sourceId: mediaId, sourceGeneration: null, artifactId: artifact,
    generation: saved.generation, size: saved.size, sha256: saved.sha256 }
  const media = { kind: 'media', sourceId: mediaId, sourceGeneration: '123', artifactId: secondId,
    generation: second.generation, size: second.size, sha256: second.sha256 }
  const manifest = encodeUnverifiedHeldManifest({ environment: 'dev', operationId, ideaId, holdId, entries: [entry, media] })
  const manifestRef = await writeUnverifiedHeldMaterial(storage, target, manifestId, manifest)
  const intent = encodeRecoveryIntent({ environment: 'dev', operationId, ideaId, actorId, authorizedAt: '2026-11-03T12:00:00.000Z',
    decision: { kind: 'hold_placement', caseReference: 'synthetic case', reason: 'synthetic reason',
      authorizationReference: 'synthetic authority', scope: 'synthetic scope' } })
  const confirmation = encodeRecoveryHoldManifestConfirmation(operationId, 'dev', '2026-11-03T12:01:00.000Z', holdId,
    '88888888-8888-4888-8888-888888888888', '2026-11-03T12:00:00.123456Z',
    { actorId, authority: 'executive_director', grantedBy: actorId, grantedAt: '2026-11-03T11:59:00.000000Z',
      authorizationReference: 'synthetic authority' },
    { artifactId: manifestId, generation: manifestRef.generation, size: manifestRef.size, sha256: manifestRef.sha256 })
  assert.deepEqual(await verifyUnverifiedHeldCapture(storage, target, intent, confirmation),
    { checkedArtifacts: 2, totalBytes: manifest.length + contents.length + secondBytes.length, coverageVerified: false })
  const sources = [{ kind: 'revision', sourceId: mediaId, sourceGeneration: null },
    { kind: 'media', sourceId: mediaId, sourceGeneration: '123' }]
  const verifying = verifyUnverifiedHeldCaptureAgainstSources(storage, target, intent, confirmation, sources)
  sources[0].sourceId = operationId
  sources.pop()
  assert.deepEqual(await verifying, { checkedArtifacts: 2, totalBytes: manifest.length + contents.length + secondBytes.length,
    matchedSources: 2, scopeVerified: false, coverageVerified: false })
  const readsBeforeMismatch = reads()
  await assert.rejects(verifyUnverifiedHeldCaptureAgainstSources(storage, target, intent, confirmation,
    [{ kind: 'media', sourceId: mediaId, sourceGeneration: '123' }]), /could not be verified/)
  assert.equal(reads() - readsBeforeMismatch, 1) // Reject the mismatched inventory before reading artifacts.
  const readsBeforeInvalid = reads()
  await assert.rejects(verifyUnverifiedHeldCaptureAgainstSources(storage, target, intent, confirmation, new Array(2)), /Invalid held capture/)
  assert.equal(reads(), readsBeforeInvalid)
  const readsBeforeBudget = reads()
  await assert.rejects(verifyUnverifiedHeldCapture(storage, target, intent, confirmation, 120_000, contents.length), /could not be verified/)
  assert.equal(reads() - readsBeforeBudget, 0) // The manifest alone exceeds the budget.
  await assert.rejects(verifyUnverifiedHeldCapture(storage, target, intent, confirmation, 120_000, manifest.length), /could not be verified/)
  assert.equal(reads() - readsBeforeBudget, 1) // Artifacts exceed the remaining budget.
  assert.equal((await verifyUnverifiedHeldCapture(storage, target, intent, confirmation, 120_000,
    manifest.length + contents.length + secondBytes.length)).totalBytes, manifest.length + contents.length + secondBytes.length)
  const sequenceTarget = { environment: 'dev', projectNumber: '123456789', secretId: 'synthetic-journal', epochId: mediaId }
  const nonce = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const base = { environment: 'dev', epochId: sequenceTarget.epochId }
  const entries = [encodeRecoverySequenceEntry({ ...base, kind: 'baseline', checkpointDigest: 'a'.repeat(64) }),
    encodeRecoverySequenceEntry({ ...base, kind: 'decision', recordId: operationId, data: Buffer.from(intent).toString('base64') }),
    encodeRecoverySequenceEntry({ ...base, kind: 'decision', recordId: recoveryConfirmationRecordId(operationId), data: Buffer.from(confirmation).toString('base64') }),
    encodeRecoverySequenceEntry({ ...base, kind: 'fence', nonce })]
  const parent = `projects/${sequenceTarget.projectNumber}/secrets/${sequenceTarget.secretId}`
  const sequenceReader = { async request(method, path) {
    const match = new RegExp(`^${parent}/versions/([1-9][0-9]*):access$`).exec(path)
    assert.equal(method, 'GET'); assert.ok(match)
    const bytes = entries[Number(match[1]) - 1]
    if (!bytes) return { status: 404, data: null }
    const crc = new CRC32C(); crc.update(Buffer.from(bytes))
    return { status: 200, data: { name: `${parent}/versions/${match[1]}`,
      payload: { data: Buffer.from(bytes).toString('base64'), dataCrc32c: String(Buffer.from(crc.toString(), 'base64').readUInt32BE(0)) } } }
  } }
  assert.deepEqual(await verifySequenceHeldCaptures(sequenceReader, sequenceTarget, '4', nonce, storage, target),
    { checkedCaptures: 1, checkedArtifacts: 2, totalBytes: manifest.length + contents.length + secondBytes.length, incompletePlacements: 0,
      reviewOperations: 1, unmatchedConfirmations: 0, coverageVerified: false, authorityVerified: false })
  const confirmationFrame = entries.splice(2, 1)[0]
  assert.deepEqual(await verifySequenceHeldCaptures(sequenceReader, sequenceTarget, '3', nonce, storage, target),
    { checkedCaptures: 0, checkedArtifacts: 0, totalBytes: 0, incompletePlacements: 1,
      reviewOperations: 1, unmatchedConfirmations: 0, coverageVerified: false, authorityVerified: false })
  entries.splice(2, 0, confirmationFrame)
  await assert.rejects(verifySequenceHeldCaptures(sequenceReader, sequenceTarget, '4', nonce, storage, { ...target, environment: 'prod' }), /Invalid/)
  const previous = { ...sequenceTarget, fenceVersion: '3', fenceNonce: nonce }
  const previousEntries = [entries[0], entries[1], entries[3]]
  const checkpoint = unverifiedRolloverCheckpoint(previous, previousEntries.map((payload, index) => ({ version: String(index + 1), payload })))
  const next = { ...previous, secretId: 'synthetic-next', epochId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    fenceNonce: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }
  const nextBase = { environment: 'dev', epochId: next.epochId }
  const nextEntries = [encodeRecoverySequenceEntry({ ...nextBase, kind: 'baseline', checkpointDigest: checkpoint.checkpointDigest }),
    encodeRecoverySequenceEntry({ ...nextBase, kind: 'decision', recordId: recoveryConfirmationRecordId(operationId), data: Buffer.from(confirmation).toString('base64') }),
    encodeRecoverySequenceEntry({ ...nextBase, kind: 'fence', nonce: next.fenceNonce })]
  const readerFor = (descriptor, source) => ({ async request(method, path) {
    const sourceParent = `projects/${descriptor.projectNumber}/secrets/${descriptor.secretId}`
    const match = new RegExp(`^${sourceParent}/versions/([1-9][0-9]*):access$`).exec(path)
    assert.equal(method, 'GET'); assert.ok(match)
    const bytes = source[Number(match[1]) - 1]
    if (!bytes) return { status: 404, data: null }
    const crc = new CRC32C(); crc.update(Buffer.from(bytes))
    return { status: 200, data: { name: `${sourceParent}/versions/${match[1]}`,
      payload: { data: Buffer.from(bytes).toString('base64'), dataCrc32c: String(Buffer.from(crc.toString(), 'base64').readUInt32BE(0)) } } }
  } })
  const previousReader = readerFor(previous, previousEntries), nextReader = readerFor(next, nextEntries)
  assert.deepEqual(await verifyRolloverHeldCaptures(previousReader, previous, nextReader, next, storage, target),
    { checkedCaptures: 1, checkedArtifacts: 2, totalBytes: manifest.length + contents.length + secondBytes.length, incompletePlacements: 0,
      reviewOperations: 1, unmatchedConfirmations: 0, coverageVerified: false, authorityVerified: false, earlierEpochsIncluded: false })
  const nextCheckpoint = unverifiedRolloverCheckpoint(next, nextEntries.map((payload, index) => ({ version: String(index + 1), payload })))
  const third = { ...next, secretId: 'synthetic-third', epochId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    fenceVersion: '2', fenceNonce: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }
  const thirdBase = { environment: 'dev', epochId: third.epochId }
  const thirdEntries = [encodeRecoverySequenceEntry({ ...thirdBase, kind: 'baseline', checkpointDigest: nextCheckpoint.checkpointDigest }),
    encodeRecoverySequenceEntry({ ...thirdBase, kind: 'fence', nonce: third.fenceNonce })]
  const chain = [{ reader: previousReader, descriptor: previous }, { reader: nextReader, descriptor: next },
    { reader: readerFor(third, thirdEntries), descriptor: third }]
  assert.deepEqual(await verifySequenceChainHeldCaptures(chain, storage, target),
    { checkedCaptures: 1, checkedArtifacts: 2, totalBytes: manifest.length + contents.length + secondBytes.length, incompletePlacements: 0,
      reviewOperations: 1, unmatchedConfirmations: 0, coverageVerified: false, authorityVerified: false, epochCount: 3, earlierEpochsIncluded: false })
  const beforeMissing = reads()
  nextEntries[1] = undefined
  await assert.rejects(verifyRolloverHeldCaptures(previousReader, previous, nextReader, next, storage, target), /could not be verified/)
  await assert.rejects(verifySequenceChainHeldCaptures(chain, storage, target), /could not be verified/)
  assert.equal(reads(), beforeMissing)
  const mediaPath = `idea-map-v2/dev/held-material/${secondId}.bin`
  objects.get(mediaPath).body = Buffer.alloc(secondBytes.length, 1)
  await assert.rejects(verifyUnverifiedHeldCapture(storage, target, intent, confirmation), /could not be verified/)
  await assert.rejects(verifySequenceHeldCaptures(sequenceReader, sequenceTarget, '4', nonce, storage, target), /could not be verified/)
  objects.delete(`idea-map-v2/dev/held-material/${secondId}.bin`)
  await assert.rejects(verifyUnverifiedHeldCapture(storage, target, intent, confirmation), error =>
    error.message === 'Held capture could not be verified' && !error.message.includes('private'))
  await assert.rejects(verifyUnverifiedHeldCapture(storage, target, intent, confirmation, 0), /Invalid/)
  const bigEntries = Array.from({ length: 9 }, (_, index) => ({ kind: 'revision',
    sourceId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, sourceGeneration: null,
    artifactId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`, generation: '1', size: 16 * 1024 * 1024, sha256: 'a'.repeat(64) }))
  const bigBytes = encodeUnverifiedHeldManifest({ environment: 'dev', operationId, ideaId, holdId, entries: bigEntries })
  const bigId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const bigRef = await writeUnverifiedHeldMaterial(storage, target, bigId, bigBytes)
  const bigConfirmation = encodeRecoveryHoldManifestConfirmation(operationId, 'dev', '2026-11-03T12:01:00.000Z', holdId,
    '88888888-8888-4888-8888-888888888888', '2026-11-03T12:00:00.123456Z',
    { actorId, authority: 'executive_director', grantedBy: actorId, grantedAt: '2026-11-03T11:59:00.000000Z',
      authorizationReference: 'synthetic authority' },
    { artifactId: bigId, generation: bigRef.generation, size: bigRef.size, sha256: bigRef.sha256 })
  const before = reads()
  await assert.rejects(verifyUnverifiedHeldCapture(storage, target, intent, bigConfirmation), /could not be verified/)
  assert.equal(reads() - before, 1)
})
