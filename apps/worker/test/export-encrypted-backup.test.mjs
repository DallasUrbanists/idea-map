import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { backupConfiguration, backupConnectionEnvironment, exportEncryptedBackup, startDump, verifyBackupBucket } from '../ops/export-encrypted-backup.mjs'

const env = { BACKUP_ENVIRONMENT: 'dev', BACKUP_BUCKET: 'synthetic-private-backups', BACKUP_PROJECT_NUMBER: '123456789',
  BACKUP_DATABASE_URL: 'postgres://test:secret@example.invalid/db?sslmode=verify-full&sslrootcert=system' }
const metadata = { name: env.BACKUP_BUCKET, projectNumber: env.BACKUP_PROJECT_NUMBER, generation: '11', metageneration: '1',
  iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
  versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }

test('backup configuration requires direct verified TLS and a hosted production job', () => {
  assert.equal(backupConfiguration(env).environment, 'dev')
  assert.equal(backupConfiguration({ ...env, BACKUP_DATABASE_URL: `${env.BACKUP_DATABASE_URL}&gssencmode=disable` }).environment, 'dev')
  assert.equal(backupConfiguration({ ...env, BACKUP_DATABASE_URL: 'postgres://test:secret@[::1]/db?sslmode=verify-full&sslrootcert=system' }).environment, 'dev')
  assert.deepEqual(backupConnectionEnvironment('postgres://user%40test:p%3Ass@[::1]:5433/data%23set?sslmode=verify-full&sslrootcert=system&channel_binding=require'),
    { PGHOST: '::1', PGDATABASE: 'data#set', PGPORT: '5433', PGUSER: 'user@test', PGPASSWORD: 'p:ss',
      PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'system', PGGSSENCMODE: 'disable', PGCHANNELBINDING: 'require' })
  for (const change of [
    { BACKUP_ENVIRONMENT: 'v1' }, { BACKUP_BUCKET: 'gs://wrong' }, { BACKUP_PROJECT_NUMBER: 'bad' },
    { STORAGE_EMULATOR_HOST: '' }, { STORAGE_EMULATOR_HOST: 'http://127.0.0.1:8080' },
    { BACKUP_ENVIRONMENT: 'prod' }, { BACKUP_DATABASE_URL: 'postgres://example.invalid/db' },
    { BACKUP_DATABASE_URL: 'postgres://example-pooler.neon.tech/db?sslmode=verify-full&sslrootcert=system' },
    { BACKUP_DATABASE_URL: 'postgres://EXAMPLE-POOLER.NEON.TECH/db?sslmode=verify-full&sslrootcert=system' },
    { BACKUP_DATABASE_URL: 'postgres://example%2dpooler.neon.tech/db?sslmode=verify-full&sslrootcert=system' },
    { BACKUP_DATABASE_URL: 'postgres://example-pooler%2eneon.tech/db?sslmode=verify-full&sslrootcert=system' },
    { BACKUP_DATABASE_URL: 'postgres://%2Ftmp/db?sslmode=verify-full&sslrootcert=system' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid,other.invalid/db?sslmode=verify-full&sslrootcert=system' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&sslmode=disable' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system#&sslmode=disable' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system#' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&options=-c%20role%3Dother' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&channel_binding=disable' },
    { BACKUP_DATABASE_URL: 'postgres://test:p%00ass@example.invalid/db?sslmode=verify-full&sslrootcert=system' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&host=other.invalid' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&ssl=true' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&dbname=other' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&port=5433' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&user=other' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&password=other' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&gssencmode=require' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&gssencmode=disable&gssencmode=prefer' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&sslkeylogfile=keys' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system&requiressl=1' },
    { BACKUP_DATABASE_URL: 'postgres://example.invalid/db?sslmode=verify-full' },
  ]) {
    // Keep unrelated URL rejection cases independently valid for credentials.
    if (change.BACKUP_DATABASE_URL && !change.BACKUP_DATABASE_URL.includes('@')) {
      change.BACKUP_DATABASE_URL = change.BACKUP_DATABASE_URL.replace('postgres://', 'postgres://test:secret@')
    }
    assert.throws(() => backupConfiguration({ ...env, ...change }))
  }
  for (const url of [
    'postgres://example.invalid/db?sslmode=verify-full&sslrootcert=system',
    'postgres://test@example.invalid/db?sslmode=verify-full&sslrootcert=system',
    'postgres://test:@example.invalid/db?sslmode=verify-full&sslrootcert=system',
    'postgres://:secret@example.invalid/db?sslmode=verify-full&sslrootcert=system',
  ]) assert.throws(() => backupConfiguration({ ...env, BACKUP_DATABASE_URL: url }))
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

function provider(bucketMetadata = metadata, failWeekly = false, failCompletion = false, mismatchedWeekly = false, ambiguousCompletion = false, stallUpload = false, archiveBucket = env.BACKUP_BUCKET) {
  const states = []
  const manifests = []
  const bucket = { async getMetadata() { return [bucketMetadata] }, file(name) {
    if (name.endsWith('.complete')) {
      const file = { async save(content, options) {
        if (failCompletion) throw new Error('synthetic completion failure')
        manifests.push({ name, content, options })
        file.metadata = { name, bucket: env.BACKUP_BUCKET, generation: '124', metageneration: '1',
          size: '0', crc32c: 'AAAAAA==', metadata: { ...options.metadata.metadata } }
        if (ambiguousCompletion) delete file.metadata.metadata.daily_generation
      } }
      return file
    }
    const state = { name, finalized: false, destroyed: false, bytes: '', options: null }
    states.push(state)
    const file = { createWriteStream(options) {
      state.options = options
      return new Writable({
        write(chunk, encoding, callback) { state.bytes += chunk.toString(); callback(failWeekly && name.includes('/weekly/') ? new Error('synthetic upload failure') : undefined) },
        final(callback) {
          if (stallUpload) return
          state.finalized = true; file.metadata = { name, bucket: archiveBucket, generation: '123', metageneration: '1', size: String(Buffer.byteLength(state.bytes) + (mismatchedWeekly && name.includes('/weekly/') ? 1 : 0)), crc32c: 'AAAAAA==' }; callback()
        },
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
  assert.equal(childEnv.PGDATABASE, 'db')
  assert.equal(childEnv.PGHOST, 'example.invalid')
  assert.equal(childEnv.PGUSER, 'test')
  assert.equal(childEnv.PGPASSWORD, 'secret')
  assert.equal(childEnv.PGSSLMODE, 'verify-full')
  assert.equal(childEnv.PGSSLROOTCERT, 'system')
  assert.equal(childEnv.BACKUP_DATABASE_URL, undefined)
  assert.equal(childEnv.PGGSSENCMODE, 'disable')
  assert.ok(Object.keys(childEnv).every(key => ['PATH', 'SystemRoot', 'WINDIR', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
    'PGSSLMODE', 'PGSSLROOTCERT', 'PGCHANNELBINDING', 'PGCONNECT_TIMEOUT', 'PGGSSENCMODE'].includes(key)))
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

test('export retains its selected target, database, and time across storage waits', async () => {
  const fake = provider()
  const configuration = backupConfiguration(env)
  const selectedTime = new Date('2026-11-02T10:00:00Z')
  const options = { storage: fake.storage, now: selectedTime, start: () => source() }
  const result = exportEncryptedBackup(configuration, options)
  configuration.environment = 'prod'
  configuration.bucket = 'synthetic-wrong-bucket'
  configuration.projectNumber = '987654321'
  configuration.databaseUrl = 'postgres://other.invalid/db?sslmode=disable'
  selectedTime.setUTCFullYear(2040)
  options.start = () => { throw new Error('Changed source must not run') }
  const exported = await result
  assert.equal(exported.startedAt, '2026-11-02T10:00:00.000Z')
  assert.ok(exported.objects.every(name => name.startsWith('idea-map-v2/dev/')))
  assert.equal(fake.manifests[0].options.metadata.metadata.backup_started_at, exported.startedAt)
})

test('an archive response without the selected bucket prevents completion', async () => {
  for (const archiveBucket of ['synthetic-wrong-bucket', null]) {
    const fake = provider(metadata, false, false, false, false, false, archiveBucket)
    await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: fake.storage, start: () => source() }))
    assert.equal(fake.manifests.length, 0)
  }
})

test('a changed bucket prevents a verified export', async () => {
  for (const changeAt of [2, 3]) {
    for (const field of ['generation', 'metageneration']) {
      const fake = provider()
      const bucket = fake.storage.bucket()
      let reads = 0
      bucket.getMetadata = async () => [{ ...metadata, [field]: ++reads >= changeAt ? '999' : metadata[field] }]
      await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: { bucket: () => bucket }, start: () => source() }), /bucket changed/)
      assert.equal(fake.manifests.length, changeAt === 3 ? 1 : 0) // A saved marker can outlive an uncertain response.
    }
  }
  const fake = provider({ ...metadata, generation: undefined })
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: fake.storage, start: () => source() }), /bucket identity is ambiguous/)
  assert.equal(fake.states.length, 0)
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

test('an ambiguous completion response cannot report a successful backup', async () => {
  const { storage, manifests } = provider(metadata, false, false, false, true)
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage, now: new Date('2026-11-02T10:00:00Z'), start: () => source() }))
  assert.equal(manifests.length, 1) // A failed response can still leave the marker at the provider.
})

test('stalled bucket and completion requests fail without reporting a completed export', async () => {
  let started = false, finishMetadata
  const stalledBucket = { bucket: () => ({ async getMetadata() { return new Promise(resolve => { finishMetadata = resolve }) } }) }
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: stalledBucket, providerTimeoutMs: 20,
    start: () => { started = true; return source() } }), /timed out/)
  finishMetadata([metadata])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(started, false)
  const fake = provider()
  const bucket = fake.storage.bucket()
  const original = bucket.file.bind(bucket)
  bucket.file = name => name.endsWith('.complete') ? { async save() { return new Promise(() => {}) } } : original(name)
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: { bucket: () => bucket }, providerTimeoutMs: 20,
    now: new Date('2026-11-02T10:00:00Z'), start: () => source() }), /timed out/)
  assert.ok(fake.states.every(state => state.finalized)) // The provider may still create a marker after the timeout.
})

test('a stalled archive upload is destroyed and never creates a completion marker', async () => {
  const fake = provider(metadata, false, false, false, false, true)
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: fake.storage, transferTimeoutMs: 20,
    now: new Date('2026-11-02T10:00:00Z'), start: () => source() }), /timed out/)
  assert.ok(fake.states.every(state => state.destroyed && !state.finalized))
  assert.equal(fake.manifests.length, 0)
})

test('a stuck dump cannot prevent a transfer timeout from completing', { timeout: 2000 }, async () => {
  for (const stdout of [new Readable({ read() {} }), Readable.from(['synthetic partial dump'])]) {
    const fake = provider()
    const signals = []
    let unreferenced = false
    const dump = { child: { stdout, kill(signal) { signals.push(signal) }, unref() { unreferenced = true } },
      done: new Promise(() => {}) }
    await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: fake.storage,
      transferTimeoutMs: 20, cleanupTimeoutMs: 20, start: () => dump }), /transfer timed out/)
    assert.ok(signals.includes('SIGTERM'))
    assert.equal(signals.at(-1), 'SIGKILL')
    assert.equal(unreferenced, true)
    assert.equal(stdout.destroyed, true)
    assert.ok(fake.states.every(state => state.destroyed && !state.finalized))
    assert.equal(fake.manifests.length, 0)
  }
})

test('a stuck dump cannot prevent cleanup after upload setup fails', { timeout: 2000 }, async () => {
  const signals = []
  const stdout = new Readable({ read() {} })
  const dump = { child: { stdout, kill(signal) { signals.push(signal) }, unref() {} }, done: new Promise(() => {}) }
  const bucket = { async getMetadata() { return [metadata] }, file() { throw new Error('Synthetic setup failure') } }
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage: { bucket: () => bucket },
    cleanupTimeoutMs: 20, start: () => dump }), /Synthetic setup failure/)
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(stdout.destroyed, true)
})

test('different archive metadata prevents a completion record', async () => {
  const { storage, manifests } = provider(metadata, false, false, true)
  await assert.rejects(exportEncryptedBackup(backupConfiguration(env), { storage, now: new Date('2026-11-02T10:00:00Z'), start: () => source() }))
  assert.equal(manifests.length, 0)
})

test('an unverified or public bucket prevents the dump from starting', async () => {
  assert.doesNotThrow(() => verifyBackupBucket({ ...metadata, lifecycle: { rule: [{ action: { type: 'SetStorageClass' } }] } }, backupConfiguration(env)))
  assert.doesNotThrow(() => verifyBackupBucket({ ...metadata, defaultEventBasedHold: false, hierarchicalNamespace: { enabled: false } }, backupConfiguration(env)))
  for (const bucket of [
    { ...metadata, projectNumber: '987654321' },
    { ...metadata, iamConfiguration: { ...metadata.iamConfiguration, publicAccessPrevention: 'inherited' } },
    { ...metadata, versioning: { enabled: false } },
    { ...metadata, defaultEventBasedHold: true },
    { ...metadata, defaultEventBasedHold: 'false' },
    { ...metadata, hierarchicalNamespace: { enabled: true } },
    { ...metadata, hierarchicalNamespace: {} },
    { ...metadata, retentionPolicy: { retentionPeriod: '7776000' } },
    { ...metadata, encryption: { defaultKmsKeyName: 'projects/synthetic/locations/global/keyRings/test/cryptoKeys/key' } },
    { ...metadata, softDeletePolicy: { retentionDurationSeconds: '0' } },
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
