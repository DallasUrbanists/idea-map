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

export function backupTarget(env) {
  if (typeof env.STORAGE_EMULATOR_HOST === 'string' || !['dev', 'prod'].includes(env.BACKUP_ENVIRONMENT) || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(env.BACKUP_BUCKET ?? '') ||
      !/^[1-9][0-9]{5,19}$/.test(env.BACKUP_PROJECT_NUMBER ?? '')) throw new Error('Invalid backup target')
  return { environment: env.BACKUP_ENVIRONMENT, bucket: env.BACKUP_BUCKET, projectNumber: env.BACKUP_PROJECT_NUMBER }
}

// Production exports run in the hosted backup job, never on a local machine.
export function backupConfiguration(env) {
  const target = backupTarget(env)
  if (target.environment === 'prod' &&
      (!/^idea-map-backup-[a-z0-9-]+$/.test(env.CLOUD_RUN_JOB ?? '') || !env.CLOUD_RUN_EXECUTION)) {
    throw new Error('Invalid backup configuration')
  }
  let url
  try { url = new URL(env.BACKUP_DATABASE_URL) } catch { throw new Error('Invalid backup configuration') }
  const host = url.hostname
  const dnsName = /^(?=.{1,254}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/i.test(host) &&
    host.replace(/\.$/, '').split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  const ipv6 = host.startsWith('[') && host.endsWith(']') && isIP(host.slice(1, -1)) === 6
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/' ||
      (!dnsName && !ipv6) || host.toLowerCase().includes('-pooler.') || url.searchParams.get('sslmode') !== 'verify-full' ||
      url.searchParams.get('sslrootcert') !== 'system' ||
      ['host', 'hostaddr', 'port', 'user', 'password', 'dbname', 'service', 'ssl', 'requiressl', 'sslkeylogfile'].some(key => url.searchParams.has(key)) ||
      ['sslmode', 'sslrootcert'].some(key => url.searchParams.getAll(key).length !== 1) ||
      url.searchParams.getAll('gssencmode').length > 1 ||
      (url.searchParams.has('gssencmode') && url.searchParams.get('gssencmode') !== 'disable')) {
    throw new Error('Invalid backup configuration')
  }
  return { ...target, databaseUrl: env.BACKUP_DATABASE_URL }
}

export const dumpArguments = Object.freeze(['--no-password', '--format=custom', '--no-owner'])

export function startDump(env, spawnProcess = spawn) {
  const child = spawnProcess('pg_dump', dumpArguments,
    { env, windowsHide: true, signal: AbortSignal.timeout(30 * 60 * 1000), stdio: ['ignore', 'pipe', 'pipe'] })
  let warning = false
  child.stderr.on('data', chunk => { if (chunk.length) warning = true })
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 && !warning ? resolveDone() : reject(new Error('Database export failed or reported a warning')))
  })
  return { child, done }
}

/** Stream one dump to a daily object and a matching weekly object when requested. */
export async function exportEncryptedBackup(config, options = {}) {
  // The database client does not need the storage credentials or other job secrets.
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid backup time')
  const date = now.toISOString().slice(0, 10)
  const id = randomUUID()
  const kinds = now.getUTCDay() === 1 || options.forceWeekly === true ? ['daily', 'weekly'] : ['daily']
  const paths = kinds.map(kind => `idea-map-v2/${config.environment}/${kind}/${date}/${id}.pgdump`)
  const bucket = options.storage.bucket(config.bucket)
  const [metadata] = await bucket.getMetadata()
  verifyBackupBucket(metadata, config)
  const dump = (options.start ?? startDump)({ ...env, PGDATABASE: config.databaseUrl, PGCONNECT_TIMEOUT: '10', PGGSSENCMODE: 'disable' })
  const uploads = []
  const files = []
  try {
    for (const path of paths) {
      const file = bucket.file(path)
      files.push(file)
      uploads.push(file.createWriteStream({ resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 } }))
    }
  } catch (error) {
    dump.child.kill()
    for (const upload of uploads) upload.destroy()
    await Promise.allSettled([dump.done])
    throw error
  }
  const tee = new PassThrough()
  const uploadDone = uploads.map(upload => finished(upload).then(() => ({ ok: true }), error => { dump.child.kill(); tee.destroy(error); return { ok: false, error } }))
  for (const upload of uploads) tee.pipe(upload, { end: false })
  const transfer = pipeline(dump.child.stdout, tee)
  try {
    await Promise.all([transfer, dump.done])
    for (const upload of uploads) upload.end()
    const results = await Promise.all(uploadDone)
    const failed = results.find(result => !result.ok)
    if (failed) throw failed.error
    const generations = files.map((file, index) => {
      const saved = file.metadata
      if (saved?.name !== paths[index] || typeof saved.generation !== 'string' || !/^[1-9][0-9]*$/.test(saved.generation) ||
          typeof saved.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(saved.metageneration) ||
          typeof saved.size !== 'string' || !/^[1-9][0-9]*$/.test(saved.size) || !/^[A-Za-z0-9+/]{6}==$/.test(saved.crc32c ?? '')) {
        throw new Error('Uploaded backup metadata is incomplete')
      }
      return { generation: saved.generation, size: saved.size, crc32c: saved.crc32c }
    })
    if (generations.length === 2 && (generations[0].size !== generations[1].size || generations[0].crc32c !== generations[1].crc32c)) {
      throw new Error('Uploaded backup copies differ')
    }
    const completion = { backup_version: '2', backup_started_at: now.toISOString() }
    for (let index = 0; index < kinds.length; index++) {
      for (const key of ['generation', 'size', 'crc32c']) completion[`${kinds[index]}_${key}`] = generations[index][key]
    }
    const completionPath = `idea-map-v2/${config.environment}/completion/${date}/${id}.complete`
    await bucket.file(completionPath).save('', { resumable: false, validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: completion } })
    return { startedAt: now.toISOString(), objects: paths }
  } catch (error) {
    dump.child.kill()
    for (const upload of uploads) upload.destroy()
    await Promise.allSettled([transfer, dump.done, ...uploadDone])
    throw error
  }
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
