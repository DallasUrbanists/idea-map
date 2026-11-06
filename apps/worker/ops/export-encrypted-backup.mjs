import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { verifyBackupBucket } from '@idea-map/server/backup-bucket'

export { verifyBackupBucket } from '@idea-map/server/backup-bucket'

/** Provider CRC32C values must encode exactly four bytes in canonical base64. */
export function isCanonicalBackupCrc32c(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{6}==$/.test(value) &&
    Buffer.from(value, 'base64').toString('base64') === value
}

export function backupTarget(env) {
  if (typeof env.STORAGE_EMULATOR_HOST === 'string' || !['dev', 'prod'].includes(env.BACKUP_ENVIRONMENT) || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(env.BACKUP_BUCKET ?? '') ||
      !/^[1-9][0-9]{5,19}$/.test(env.BACKUP_PROJECT_NUMBER ?? '')) throw new Error('Invalid backup target')
  return { environment: env.BACKUP_ENVIRONMENT, bucket: env.BACKUP_BUCKET, projectNumber: env.BACKUP_PROJECT_NUMBER }
}

/** Translate a verified connection URL into individual libpq environment fields. */
export function backupConnectionEnvironment(databaseUrl) {
  if (typeof databaseUrl !== 'string' || databaseUrl.includes('#')) throw new Error('Invalid backup configuration')
  let url
  try { url = new URL(databaseUrl) } catch { throw new Error('Invalid backup configuration') }
  const host = url.hostname
  const dnsName = /^(?=.{1,254}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/i.test(host) &&
    host.replace(/\.$/, '').split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  const ipv6 = host.startsWith('[') && host.endsWith(']') && isIP(host.slice(1, -1)) === 6
  const allowed = new Set(['sslmode', 'sslrootcert', 'gssencmode', 'channel_binding'])
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/' || url.hash ||
      (!dnsName && !ipv6) || host.toLowerCase().includes('-pooler.') || url.searchParams.get('sslmode') !== 'verify-full' ||
      url.searchParams.get('sslrootcert') !== 'system' ||
      [...url.searchParams.keys()].some(key => !allowed.has(key)) ||
      ['sslmode', 'sslrootcert'].some(key => url.searchParams.getAll(key).length !== 1) ||
      url.searchParams.getAll('gssencmode').length > 1 ||
      (url.searchParams.has('gssencmode') && url.searchParams.get('gssencmode') !== 'disable') ||
      url.searchParams.getAll('channel_binding').length > 1 ||
      (url.searchParams.has('channel_binding') && !['require', 'prefer'].includes(url.searchParams.get('channel_binding')))) {
    throw new Error('Invalid backup configuration')
  }
  let database, user, password
  try {
    database = decodeURIComponent(url.pathname.slice(1))
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
  } catch { throw new Error('Invalid backup configuration') }
  if (!database || !user || !password || [database, user, password].some(value => /[\x00-\x1f\x7f]/u.test(value))) {
    throw new Error('Invalid backup configuration')
  }
  return { PGHOST: ipv6 ? host.slice(1, -1) : host, PGDATABASE: database,
    ...(url.port ? { PGPORT: url.port } : {}), PGUSER: user, PGPASSWORD: password,
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: 'system', PGGSSENCMODE: 'disable',
    ...(url.searchParams.has('channel_binding') ? { PGCHANNELBINDING: url.searchParams.get('channel_binding') } : {}) }
}

// Production exports run in the hosted backup job, never on a local machine.
export function backupConfiguration(env) {
  const target = backupTarget(env)
  if (target.environment === 'prod' &&
      (!/^idea-map-backup-[a-z0-9-]+$/.test(env.CLOUD_RUN_JOB ?? '') || !env.CLOUD_RUN_EXECUTION)) {
    throw new Error('Invalid backup configuration')
  }
  backupConnectionEnvironment(env.BACKUP_DATABASE_URL)
  return { ...target, databaseUrl: env.BACKUP_DATABASE_URL }
}

export const dumpArguments = Object.freeze(['--no-password', '--format=custom', '--no-owner'])
const snapshotPattern = /^[0-9A-F]{8}-[0-9A-F]{8}-[1-9][0-9]{0,9}$/
const sha256Pattern = /^[0-9a-f]{64}$/

export function startDump(env, snapshotId, spawnProcess = spawn) {
  if (typeof snapshotId !== 'string' || !snapshotPattern.test(snapshotId)) throw new Error('Invalid export snapshot')
  const child = spawnProcess('pg_dump', [...dumpArguments, `--snapshot=${snapshotId}`],
    { env, windowsHide: true, signal: AbortSignal.timeout(30 * 60 * 1000), stdio: ['ignore', 'pipe', 'pipe'] })
  let warning = false
  child.stderr.on('data', chunk => { if (chunk.length) warning = true })
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 && !warning ? resolveDone() : reject(new Error('Database export failed or reported a warning')))
  })
  return { child, done }
}

// This bounds waiting, not the lifetime of an SDK request already in flight.
async function withinProviderTimeout(action, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  let timer
  try {
    const result = await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Backup storage request timed out')), timeoutMs) }),
    ])
    if (performance.now() >= deadline) throw new Error('Backup storage request timed out')
    return result
  } finally { clearTimeout(timer) }
}

function stopDump(child, signal = 'SIGTERM') {
  if (child.exitCode != null || child.signalCode != null) return
  try { child.kill(signal) } catch { /* The process may already have exited. */ }
}

// An SDK stream or a child that ignores termination must not block cleanup forever.
async function settleFailedTransfer(dump, pending, timeoutMs) {
  stopDump(dump.child)
  let timer
  const settled = await Promise.race([
    Promise.allSettled(pending).then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) }),
  ])
  clearTimeout(timer)
  if (!settled) {
    stopDump(dump.child, 'SIGKILL')
    dump.child.stdout?.destroy()
    dump.child.stderr?.destroy()
    dump.child.unref?.()
  }
}

export const defaultAclDigestSql = `SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE(
  pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'owner', pg_catalog.pg_get_userbyid(d.defaclrole), 'schema', n.nspname,
    'type', d.defaclobjtype, 'acl', d.defaclacl::text
  ) ORDER BY pg_catalog.pg_get_userbyid(d.defaclrole)::text COLLATE pg_catalog."C",
    n.nspname::text COLLATE pg_catalog."C" NULLS FIRST, d.defaclobjtype,
    d.defaclacl::text COLLATE pg_catalog."C"), '[]'::jsonb)::text, 'UTF8')), 'hex')
FROM pg_catalog.pg_default_acl AS d
LEFT JOIN pg_catalog.pg_namespace AS n ON n.oid=d.defaclnamespace`

/** Hold a read-only snapshot open until pg_dump finishes importing and using it. */
export async function openBackupSnapshot(env, spawnProcess = spawn) {
  const child = spawnProcess('psql', ['--no-psqlrc', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { env, windowsHide: true, signal: AbortSignal.timeout(31 * 60 * 1000), stdio: ['pipe', 'pipe', 'pipe'] })
  const unavailable = () => new Error('Backup snapshot evidence is unavailable')
  const ready = Promise.withResolvers()
  const exited = new Promise(resolve => child.once('close', resolve))
  let output = '', invalid = false
  const fail = () => { invalid = true; ready.reject(unavailable()) }
  child.on('error', fail)
  child.stdin.on('error', fail)
  child.stdout.on('error', fail)
  child.stderr.on('data', fail)
  child.stdout.on('data', chunk => {
    if (invalid) return
    output += chunk.toString('utf8')
    if (output.length > 100) { fail(); return }
    if (!output.includes('\n')) return
    const match = /^([^:\r\n]+):([0-9a-f]{64})\r?\n$/.exec(output)
    if (!match || !snapshotPattern.test(match[1])) { fail(); return }
    ready.resolve({ id: match[1], defaultAclSha256: match[2] })
  })
  child.stdin.write(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL idle_in_transaction_session_timeout = '31min';
SELECT pg_catalog.pg_export_snapshot() || ':' || (${defaultAclDigestSql});
`)
  try {
    const evidence = await withinProviderTimeout(() => Promise.race([ready.promise,
      exited.then(() => { throw unavailable() })]), 15_000)
    let closing
    return { ...evidence, close() {
      closing ??= (async () => {
        try {
          if (child.exitCode !== null || child.signalCode !== null) throw unavailable()
          child.stdin.end('ROLLBACK;\n')
          if (await withinProviderTimeout(() => exited, 5000) !== 0 || invalid) throw unavailable()
        } catch {
          child.stdin.destroy()
          await settleFailedTransfer({ child }, [exited], 5000)
          throw unavailable()
        }
      })()
      return closing
    } }
  } catch {
    child.stdin.destroy()
    await settleFailedTransfer({ child }, [exited], 5000)
    throw unavailable()
  }
}

async function verifiedBucketIdentity(bucket, destination, timeoutMs) {
  const [metadata] = await withinProviderTimeout(() => bucket.getMetadata(), timeoutMs)
  verifyBackupBucket(metadata, destination)
  if (typeof metadata.generation !== 'string' || !/^[1-9][0-9]*$/.test(metadata.generation) ||
      typeof metadata.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(metadata.metageneration)) {
    throw new Error('Backup bucket identity is ambiguous')
  }
  return { generation: metadata.generation, metageneration: metadata.metageneration }
}

/** Stream one dump to a daily object and a matching weekly object when requested. */
export async function exportEncryptedBackup(config, options = {}) {
  const destination = { environment: config?.environment, bucket: config?.bucket,
    projectNumber: config?.projectNumber, databaseUrl: config?.databaseUrl }
  backupTarget({ BACKUP_ENVIRONMENT: destination.environment, BACKUP_BUCKET: destination.bucket,
    BACKUP_PROJECT_NUMBER: destination.projectNumber })
  // The database client does not need the storage credentials or other job secrets.
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
  const selectedTime = options.now ?? new Date()
  if (!(selectedTime instanceof Date) || !Number.isFinite(selectedTime.getTime())) throw new Error('Invalid backup time')
  const now = new Date(selectedTime.getTime())
  const start = options.start ?? startDump
  const providerTimeoutMs = options.providerTimeoutMs ?? 15_000
  if (!Number.isInteger(providerTimeoutMs) || providerTimeoutMs < 1 || providerTimeoutMs > 15_000) throw new Error('Invalid backup timeout')
  const transferTimeoutMs = options.transferTimeoutMs ?? 30 * 60 * 1000
  if (!Number.isInteger(transferTimeoutMs) || transferTimeoutMs < 1 || transferTimeoutMs > 30 * 60 * 1000) throw new Error('Invalid backup timeout')
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5000
  if (!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 5000) throw new Error('Invalid backup timeout')
  const connection = backupConnectionEnvironment(destination.databaseUrl)
  const date = now.toISOString().slice(0, 10)
  const id = randomUUID()
  const kinds = now.getUTCDay() === 1 || options.forceWeekly === true ? ['daily', 'weekly'] : ['daily']
  const paths = kinds.map(kind => `idea-map-v2/${destination.environment}/${kind}/${date}/${id}.pgdump`)
  const bucket = options.storage.bucket(destination.bucket)
  const initialBucket = await verifiedBucketIdentity(bucket, destination, providerTimeoutMs)
  const checkBucket = async () => {
    const observed = await verifiedBucketIdentity(bucket, destination, providerTimeoutMs)
    if (observed.generation !== initialBucket.generation || observed.metageneration !== initialBucket.metageneration) {
      throw new Error('Backup bucket changed')
    }
  }
  const childEnv = { ...env, ...connection, PGCONNECT_TIMEOUT: '10' }
  const snapshot = await (options.openSnapshot ?? openBackupSnapshot)(childEnv)
  let snapshotNeedsClose = true
  try {
    const { id: snapshotId, defaultAclSha256 } = snapshot
    if (typeof snapshotId !== 'string' || !snapshotPattern.test(snapshotId) ||
        typeof defaultAclSha256 !== 'string' || !sha256Pattern.test(defaultAclSha256)) {
      throw new Error('Invalid backup snapshot evidence')
    }
    const dump = start(childEnv, snapshotId)
    const generations = await uploadBackupArchive(dump, bucket, destination, paths, transferTimeoutMs, cleanupTimeoutMs)
    snapshotNeedsClose = false
    await snapshot.close()
    await checkBucket()
    const completion = { backup_version: '4', backup_started_at: now.toISOString(),
      bucket_generation: initialBucket.generation, bucket_metageneration: initialBucket.metageneration,
      source_default_acl_sha256: defaultAclSha256 }
    for (let index = 0; index < kinds.length; index++) {
      for (const key of ['generation', 'size', 'crc32c']) completion[`${kinds[index]}_${key}`] = generations[index][key]
    }
    const completionPath = `idea-map-v2/${destination.environment}/completion/${date}/${id}.complete`
    const marker = bucket.file(completionPath)
    await withinProviderTimeout(() => marker.save('', { resumable: false, validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: completion } }), providerTimeoutMs)
    const saved = marker.metadata
    if (saved?.name !== completionPath || saved.bucket !== destination.bucket ||
        typeof saved.generation !== 'string' || !/^[1-9][0-9]*$/.test(saved.generation) ||
        typeof saved.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(saved.metageneration) ||
        saved.size !== '0' || saved.crc32c !== 'AAAAAA==' || !saved.metadata ||
        typeof saved.metadata !== 'object' || Array.isArray(saved.metadata) ||
        Object.keys(saved.metadata).length !== Object.keys(completion).length ||
        !Object.entries(completion).every(([key, value]) => Object.hasOwn(saved.metadata, key) && saved.metadata[key] === value)) {
      throw new Error('Backup completion metadata is ambiguous')
    }
    await checkBucket()
    return { startedAt: now.toISOString(), objects: paths }
  } finally {
    if (snapshotNeedsClose) await snapshot.close().catch(() => {})
  }
}

async function uploadBackupArchive(dump, bucket, destination, paths, transferTimeoutMs, cleanupTimeoutMs) {
  const uploads = []
  const files = []
  try {
    for (const path of paths) {
      const file = bucket.file(path)
      files.push(file)
      uploads.push(file.createWriteStream({ resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 } }))
    }
  } catch (error) {
    for (const upload of uploads) upload.destroy()
    await settleFailedTransfer(dump, [dump.done], cleanupTimeoutMs)
    throw error
  }
  const tee = new PassThrough()
  const uploadDone = uploads.map(upload => finished(upload).then(() => ({ ok: true }), error => { stopDump(dump.child); tee.destroy(error); return { ok: false, error } }))
  for (const upload of uploads) tee.pipe(upload, { end: false })
  const transfer = pipeline(dump.child.stdout, tee)
  let transferTimedOut = false
  let transferTimer
  const timeout = new Promise((_, reject) => { transferTimer = setTimeout(() => {
    transferTimedOut = true
    stopDump(dump.child)
    tee.destroy()
    for (const upload of uploads) upload.destroy(new Error('Backup transfer timed out'))
    reject(new Error('Backup transfer timed out'))
  }, transferTimeoutMs) })
  try {
    const results = await Promise.race([(async () => {
      await Promise.all([transfer, dump.done])
      for (const upload of uploads) upload.end()
      return Promise.all(uploadDone)
    })(), timeout])
    clearTimeout(transferTimer)
    transferTimer = undefined
    const failed = results.find(result => !result.ok)
    if (failed) throw failed.error
    const generations = files.map((file, index) => {
      const saved = file.metadata
      if (saved?.name !== paths[index] || saved.bucket !== destination.bucket ||
          typeof saved.generation !== 'string' || !/^[1-9][0-9]*$/.test(saved.generation) ||
          typeof saved.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(saved.metageneration) ||
          typeof saved.size !== 'string' || !/^[1-9][0-9]*$/.test(saved.size) || !isCanonicalBackupCrc32c(saved.crc32c)) {
        throw new Error('Uploaded backup metadata is incomplete')
      }
      return { generation: saved.generation, size: saved.size, crc32c: saved.crc32c }
    })
    if (generations.length === 2 && (generations[0].size !== generations[1].size || generations[0].crc32c !== generations[1].crc32c)) {
      throw new Error('Uploaded backup copies differ')
    }
    return generations
  } catch (error) {
    if (transferTimer) { clearTimeout(transferTimer); transferTimer = undefined }
    tee.destroy()
    for (const upload of uploads) upload.destroy()
    await settleFailedTransfer(dump, [transfer, dump.done, ...uploadDone], cleanupTimeoutMs)
    if (transferTimedOut) throw new Error('Backup transfer timed out')
    throw error
  } finally { if (transferTimer) clearTimeout(transferTimer) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3 || (process.argv.length === 3 && process.argv[2] !== '--weekly')) throw new Error('Invalid backup configuration')
    const require = createRequire(new URL('../package.json', import.meta.url))
    const { Storage } = require('@google-cloud/storage')
    const result = await exportEncryptedBackup(backupConfiguration(process.env), { storage: new Storage(), forceWeekly: process.argv[2] === '--weekly' })
    console.log(JSON.stringify({ severity: 'INFO', event: 'backup_export_completed', ...result }))
  } catch {
    console.error(JSON.stringify({ severity: 'ERROR', event: 'backup_export_failed' }))
    process.exitCode = 1
  }
}
