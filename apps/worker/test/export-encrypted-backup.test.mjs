import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { backupConfiguration, exportEncryptedBackup, startDump, verifyBackupBucket } from '../ops/export-encrypted-backup.mjs'

const env = { BACKUP_ENVIRONMENT: 'dev', BACKUP_BUCKET: 'synthetic-private-backups', BACKUP_PROJECT_NUMBER: '123456789',
  BACKUP_DATABASE_URL: 'postgres://test:secret@example.invalid/db?sslmode=verify-full&sslrootcert=system' }
const metadata = { name: env.BACKUP_BUCKET, projectNumber: env.BACKUP_PROJECT_NUMBER,
  iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
  versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }

test('backup configuration requires direct verified TLS and a hosted production job', () => {
  assert.equal(backupConfiguration(env).environment, 'dev')
  for (const change of [
    { BACKUP_ENVIRONMENT: 'v1' }, { BACKUP_BUCKET: 'gs://wrong' }, { BACKUP_PROJECT_NUMBER: 'bad' },
    { STORAGE_EMULATOR_HOST: '' }, { STORAGE_EMULATOR_HOST: 'http://127.0.0.1:8080' },
    { BACKUP_ENVIRONMENT: 'prod' }, { BACKUP_DATABASE_URL: 'postgres://example.invalid/db' },
    { BACKUP_DATABASE_URL: 'postgres://example-pooler.neon.tech/db?sslmode=verify-full&sslrootcert=system' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&sslmode=disable' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&host=other.invalid' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full' },
  ]) assert.throws(() => backupConfiguration({ ...env, ...change }))
})

test('backup configuration failure emits a sanitized alert event', () => {
  const cli = fileURLToPath(new URL('../ops/export-encrypted-backup.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8', env: {
    ...process.env, BACKUP_ENVIRONMENT: 'invalid', BACKUP_DATABASE_URL: 'postgres://synthetic-secret@invalid.invalid/db',
  } })
  assert.equal(result.status, 1)
  assert.deepEqual(JSON.parse(result.stderr), { severity: 'ERROR', event: 'backup_export_failed' })
  assert.doesNotMatch(result.stderr, /synthetic-secret/)
  assert.equal(result.stdout, '')
})

test('a dump warning fails the export without exposing diagnostic contents', async () => {
  const result = startDump({}, () => spawn(process.execPath, ['-e', "process.stderr.write('synthetic sensitive warning')"], { stdio: ['ignore', 'pipe', 'pipe'] }))
  result.child.stdout.resume()
  await assert.rejects(result.done, error => error.message === 'Database export failed or reported a warning' && !error.message.includes('synthetic'))
})

function provider(bucketMetadata = metadata, failWeekly = false, failCompletion = false, mismatchedWeekly = false) {
  const states = []
  const manifests = []
  const bucket = { async getMetadata() { return [bucketMetadata] }, file(name) {
    if (name.endsWith('.complete')) return { async save(content, options) {
      if (failCompletion) throw new Error('synthetic completion failure')
      manifests.push({ name, content, options })
    } }
    const state = { name, finalized: false, destroyed: false, bytes: '', options: null }
    states.push(state)
    const file = { createWriteStream(options) {
      state.options = options
      return new Writable({
        write(chunk, encoding, callback) { state.bytes += chunk.toString(); callback(failWeekly && name.includes('/weekly/') ? new Error('synthetic upload failure') : undefined) },
        final(callback) { state.finalized = true; file.metadata = { name, generation: '123', metageneration: '1', size: String(Buffer.byteLength(state.bytes) + (mismatchedWeekly && name.includes('/weekly/') ? 1 : 0)), crc32c: 'AAAAAA==' }; callback() },
        destroy(error, callback) { state.destroyed = true; callback(error) },
      })
    } }
    return file
  } }
  return { storage: { bucket: () => bucket }, states, manifests }
}

function source(fail = false) {
  const stdout = Readable.from(['synthetic database bytes'])
  const child = { stdout, kill() {} }
  const done = new Promise((resolve, reject) => stdout.once('end', () => {
    setImmediate(() => fail ? reject(new Error('synthetic dump failure')) : resolve())
  }))
  return { child, done }
}

test('one completed Monday dump finalizes identical daily and weekly uploads', async () => {
  const { storage, states, manifests } = provider()
  let childEnv
  let dumps = 0
  const result = await exportEncryptedBackup(backupConfiguration(env), { storage, now: new Date('2026-11-02T10:00:00Z'), start: pgEnv => { childEnv = pgEnv; dumps++; return source() } })
  assert.equal(childEnv.PGDATABASE, env.BACKUP_DATABASE_URL)
  assert.equal(childEnv.BACKUP_DATABASE_URL, undefined)
  assert.ok(Object.keys(childEnv).every(key => ['PATH', 'SystemRoot', 'WINDIR', 'PGDATABASE', 'PGCONNECT_TIMEOUT'].includes(key)))
  assert.equal(dumps, 1)
  assert.equal(states.length, 2)
  for (const state of states) {
    assert.equal(state.bytes, 'synthetic database bytes')
    assert.equal(state.finalized, true)
    assert.equal(state.options.preconditionOpts.ifGenerationMatch, 0)
    assert.equal(state.options.validation, 'crc32c')
  }
  assert.match(result.objects[0], /^idea-map-v2\/dev\/daily\/2026-11-02\/[\da-f-]+\.pgdump$/)
  assert.match(result.objects[1], /^idea-map-v2\/dev\/weekly\/2026-11-02\/[\da-f-]+\.pgdump$/)
  assert.equal(manifests.length, 1)
  for (const marker of manifests) {
    assert.equal(marker.options.metadata.metadata.backup_started_at, '2026-11-02T10:00:00.000Z')
    assert.equal(marker.options.metadata.metadata.daily_generation, '123')
    assert.equal(marker.options.metadata.metadata.weekly_generation, '123')
    assert.equal(marker.options.preconditionOpts.ifGenerationMatch, 0)
    assert.equal(marker.content, '')
  }
})

test('a failed dump destroys the unfinalized upload', async () => {
  const { storage, states, manifests } = provider()
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage, now: new Date('2026-11-02T10:00:00Z'), start: () => source(true) }))
  assert.equal(states.length, 2)
  assert.ok(states.every(state => !state.finalized && state.destroyed))
  assert.equal(manifests.length, 0)
})

test('a missed weekly copy can be recreated from one new snapshot', async () => {
  const { storage, states } = provider()
  const result = await exportEncryptedBackup(backupConfiguration(env), { storage, now: new Date('2026-11-03T10:00:00Z'), forceWeekly: true, start: () => source() })
  assert.equal(states.length, 2)
  assert.ok(result.objects.some(name => name.includes('/weekly/2026-11-03/')))
})

test('a failed weekly upload aborts the daily upload and fails the run', async () => {
  const { storage, states, manifests } = provider(metadata, true)
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage, now: new Date('2026-11-02T10:00:00Z'), start: () => source() }))
  assert.equal(states.length, 2)
  assert.ok(states.every(state => !state.finalized && state.destroyed))
  assert.equal(manifests.length, 0)
})

test('a failed completion record leaves both archives unconfirmed', async () => {
  const { storage, states, manifests } = provider(metadata, false, true)
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage, now: new Date('2026-11-02T10:00:00Z'), start: () => source() }))
  assert.ok(states.every(state => state.finalized))
  assert.equal(manifests.length, 0)
})

test('different archive metadata prevents a completion record', async () => {
  const { storage, manifests } = provider(metadata, false, false, true)
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage, now: new Date('2026-11-02T10:00:00Z'), start: () => source() }))
  assert.equal(manifests.length, 0)
})

test('an unverified or public bucket prevents the dump from starting', async () => {
  assert.doesNotThrow(() => verifyBackupBucket({ ...metadata, lifecycle: { rule: [{ action: { type: 'SetStorageClass' } }] } }, backupConfiguration(env)))
  for (const bucket of [
    { ...metadata, projectNumber: '987654321' },
    { ...metadata, iamConfiguration: { ...metadata.iamConfiguration, publicAccessPrevention: 'inherited' } },
    { ...metadata, versioning: { enabled: false } },
    { ...metadata, encryption: { defaultKmsKeyName: 'projects/synthetic/locations/global/keyRings/test/cryptoKeys/key' } },
    { ...metadata, softDeletePolicy: { retentionDurationSeconds: '2592000' } },
    { ...metadata, softDeletePolicy: undefined },
    { ...metadata, lifecycle: { rule: [{ action: { type: 'Delete' } }] } },
    { ...metadata, lifecycle: {} },
  ]) {
    let started = false
    await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: provider(bucket).storage, start: () => { started = true; return source() } }))
    assert.equal(started, false)
  }
})
