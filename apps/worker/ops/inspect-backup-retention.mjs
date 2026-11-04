import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { backupTarget, verifyBackupBucket } from './export-encrypted-backup.mjs'
import { planBackupRetention } from './plan-backup-retention.mjs'

const backupObjectPattern = /^(daily|weekly|completion)\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(pgdump|complete)$/

async function listAll(bucket, query) {
  const items = []
  const tokens = new Set()
  let next = { ...query, autoPaginate: false, maxResults: 1000 }
  while (next) {
    const [page, following] = await bucket.getFiles(next)
    if (page.some(file => !file.metadata?.name?.startsWith(query.prefix))) throw new Error('Inventory prefix is ambiguous')
    items.push(...page.map(file => file.metadata))
    if (items.length > 100_000) throw new Error('Inventory is too large')
    if (!following) break
    if (!following.pageToken || tokens.has(following.pageToken)) throw new Error('Inventory pagination is ambiguous')
    tokens.add(following.pageToken)
    next = { ...query, autoPaginate: false, maxResults: 1000, pageToken: following.pageToken }
  }
  return items
}

/** Match each archive to a create-only completion record; never count orphan records. */
export function confirmCompletedExports(objects, environment, now) {
  const prefix = `idea-map-v2/${environment}/`
  const names = new Set()
  const snapshots = new Map()
  const number = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
  const crc = value => typeof value === 'string' && /^[A-Za-z0-9+/]{6}==$/.test(value)
  for (const object of objects) {
    if (!object.name?.startsWith(prefix) || names.has(object.name) || object.timeDeleted) throw new Error('Backup generations are ambiguous')
    names.add(object.name)
    const match = backupObjectPattern.exec(object.name.slice(prefix.length))
    if (!match || (match[1] === 'completion') !== (match[4] === 'complete')) throw new Error('Unexpected backup object')
    if (!number(object.generation) || !number(object.metageneration)) throw new Error('Backup generation is invalid')
    const snapshot = `${match[2]}/${match[3]}`
    const group = snapshots.get(snapshot) ?? {}
    group[match[1]] = object
    snapshots.set(snapshot, group)
  }
  const confirmed = []
  let orphanCompletions = 0
  for (const [snapshot, group] of snapshots) {
    const marker = group.completion
    if (!marker) throw new Error('Backup completion record is missing')
    const date = snapshot.slice(0, 10)
    const meta = marker.metadata ?? {}
    const startedAt = meta.backup_started_at
    const started = Date.parse(startedAt)
    const created = Date.parse(marker.timeCreated)
    const hasWeekly = ['weekly_generation', 'weekly_size', 'weekly_crc32c'].some(key => meta[key] !== undefined)
    if (meta.backup_version !== '2' || typeof startedAt !== 'string' || !Number.isFinite(started) ||
        new Date(started).toISOString() !== startedAt || startedAt.slice(0, 10) !== date ||
        !Number.isFinite(created) || created < started || created > now.getTime() || marker.size !== '0' || marker.crc32c !== 'AAAAAA==' ||
        !number(meta.daily_generation) || !number(meta.daily_size) || !crc(meta.daily_crc32c) ||
        (new Date(started).getUTCDay() === 1 && !hasWeekly) ||
        (hasWeekly && (!number(meta.weekly_generation) || !number(meta.weekly_size) || !crc(meta.weekly_crc32c) ||
          meta.weekly_size !== meta.daily_size || meta.weekly_crc32c !== meta.daily_crc32c))) {
      throw new Error('Backup completion metadata is invalid')
    }
    for (const kind of ['daily', ...(hasWeekly ? ['weekly'] : [])]) {
      const archive = group[kind]
      if (!archive) {
        if (now.getTime() - created < (kind === 'daily' ? 15 : 63) * 86_400_000) throw new Error('A recent completed archive is missing')
        continue
      }
      const archiveCreated = Date.parse(archive.timeCreated)
      if (!Number.isFinite(archiveCreated) || archiveCreated < started || archiveCreated > created ||
          archive.generation !== meta[`${kind}_generation`] || archive.size !== meta[`${kind}_size`] || archive.crc32c !== meta[`${kind}_crc32c`]) {
        throw new Error('Backup archive differs from its completion record')
      }
      confirmed.push({ ...archive, metadata: { ...archive.metadata, backup_started_at: startedAt } })
    }
    if (group.weekly && !hasWeekly) throw new Error('Unexpected weekly backup')
    if (!group.daily && !group.weekly) orphanCompletions++
  }
  return { confirmed, orphanCompletions }
}

/** Inspect all live, noncurrent, and soft-deleted backup generations; never delete. */
export async function inspectBackupRetention(storage, target, now) {
  const fixedTime = now !== undefined
  const bucket = storage.bucket(target.bucket)
  const [metadata] = await bucket.getMetadata()
  verifyBackupBucket(metadata, target)
  const prefix = `idea-map-v2/${target.environment}/`
  // The bucket also contains recovery records. Never list or inspect them as backups.
  const backupPrefixes = ['daily', 'weekly', 'completion'].map(kind => `${prefix}${kind}/`)
  const objects = (await Promise.all(backupPrefixes.map(objectPrefix => listAll(bucket, { prefix: objectPrefix, versions: true })))).flat()
  const softDeleted = Number(metadata.softDeletePolicy.retentionDurationSeconds) > 0
    ? (await Promise.all(backupPrefixes.map(objectPrefix => listAll(bucket, { prefix: objectPrefix, softDeleted: true })))).flat() : []
  now ??= new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid inventory time')
  const normalized = objects.map(object => {
    if ((object.eventBasedHold !== undefined && typeof object.eventBasedHold !== 'boolean') ||
        (object.temporaryHold !== undefined && typeof object.temporaryHold !== 'boolean')) throw new Error('Backup hold state is ambiguous')
    return { ...object, eventBasedHold: object.eventBasedHold === true, temporaryHold: object.temporaryHold === true }
  })
  const names = new Set()
  const live = []
  const pending = []
  const completions = []
  const pendingCompletions = []
  for (const object of normalized) {
    if (names.has(object.name)) throw new Error('Backup generations are ambiguous')
    names.add(object.name)
    if (object.name?.includes('/completion/')) {
      if (!object.timeDeleted) { completions.push(object); continue }
      const created = Date.parse(object.timeCreated)
      const deleted = Date.parse(object.timeDeleted)
      if (!Number.isFinite(created) || !Number.isFinite(deleted) || deleted < created || deleted > now.getTime()) throw new Error('Completion record state is ambiguous')
      pendingCompletions.push({ ...object, timeDeleted: undefined })
      continue
    }
    if (!object.timeDeleted) { live.push(object); continue }
    const age = now.getTime() - Date.parse(object.timeCreated)
    const deletion = Date.parse(object.timeDeleted)
    const minimum = object.name?.includes('/daily/') ? 15 : object.name?.includes('/weekly/') ? 63 : Infinity
    if (!Number.isFinite(age) || age < minimum * 86_400_000 || !Number.isFinite(deletion) || deletion < Date.parse(object.timeCreated) || deletion > now.getTime()) throw new Error('Unexpected noncurrent backup')
    pending.push({ ...object, timeDeleted: undefined })
  }
  for (const object of softDeleted) {
    if (!object.name?.startsWith(prefix) || names.has(object.name)) throw new Error('Soft-deleted generations are ambiguous')
    const match = backupObjectPattern.exec(object.name.slice(prefix.length))
    const day = match && Date.parse(`${match[2]}T00:00:00.000Z`)
    const created = Date.parse(object.timeCreated)
    if (!match || (match[1] === 'completion') !== (match[4] === 'complete') || !Number.isFinite(day) ||
        new Date(day).toISOString().slice(0, 10) !== match[2] || !Number.isFinite(created) ||
        created < day || created >= day + 2 * 86_400_000 || created > now.getTime() ||
        typeof object.generation !== 'string' || !/^[1-9][0-9]*$/.test(object.generation) ||
        typeof object.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(object.metageneration)) {
      throw new Error('Soft-deleted inventory is ambiguous')
    }
    names.add(object.name)
  }
  const archiveNames = new Set([...live, ...pending, ...softDeleted].map(object => object.name))
  for (const marker of pendingCompletions) {
    const daily = marker.name.replace('/completion/', '/daily/').replace(/\.complete$/, '.pgdump')
    const weekly = marker.name.replace('/completion/', '/weekly/').replace(/\.complete$/, '.pgdump')
    if (archiveNames.has(daily) || archiveNames.has(weekly)) throw new Error('Completion record became noncurrent before its archives')
  }
  const { confirmed, orphanCompletions } = confirmCompletedExports([...live, ...pending, ...completions, ...pendingCompletions], target.environment, now)
  const liveNames = new Set(live.map(object => object.name))
  const confirmedLive = confirmed.filter(object => liveNames.has(object.name))
  const plan = planBackupRetention({ environment: target.environment, complete: true, objects: confirmedLive, now })
  const latestDaily = confirmedLive.reduce((latest, object) => object.name.startsWith(`${prefix}daily/`)
    ? Math.max(latest, Date.parse(object.metadata.backup_started_at)) : latest, -Infinity)
  const latestWeekly = confirmedLive.reduce((latest, object) => object.name.startsWith(`${prefix}weekly/`)
    ? Math.max(latest, Date.parse(object.metadata.backup_started_at)) : latest, -Infinity)
  const evaluatedAt = fixedTime ? now : new Date()
  const latestDailyAgeSeconds = Number.isFinite(latestDaily) ? (evaluatedAt.getTime() - latestDaily) / 1000 : null
  const dailyFreshEnough = latestDailyAgeSeconds !== null && latestDailyAgeSeconds <= 86_400
  const latestWeeklyAgeSeconds = Number.isFinite(latestWeekly) ? (evaluatedAt.getTime() - latestWeekly) / 1000 : null
  const weeklyFreshEnough = latestWeeklyAgeSeconds !== null && latestWeeklyAgeSeconds <= 7 * 86_400
  const oldSoftDeleted = softDeleted.filter(object => {
    const created = Date.parse(object.timeCreated)
    if (!Number.isFinite(created) || !object.name?.startsWith(prefix)) throw new Error('Soft-deleted inventory is ambiguous')
    return !object.name.startsWith(`${prefix}completion/`) && now.getTime() - created >= 76 * 86_400_000
  }).length
  const oldPendingArchives = pending.filter(object => now.getTime() - Date.parse(object.timeCreated) >= 76 * 86_400_000).length
  const reviewRequired = plan.oldOrHeld > 0 || oldPendingArchives > 0 || oldSoftDeleted > 0
  return { ...plan, candidates: dailyFreshEnough && weeklyFreshEnough ? plan.candidates : [],
    dailyFreshEnough, latestDailyAgeSeconds, weeklyFreshEnough, latestWeeklyAgeSeconds,
    pendingLifecycle: pending.length, pendingCompletions: pendingCompletions.length, orphanCompletions,
    softDeleted: softDeleted.length, oldSoftDeleted, oldPendingArchives, reviewRequired }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Unexpected arguments')
    const require = createRequire(new URL('../package.json', import.meta.url))
    const { Storage } = require('@google-cloud/storage')
    const result = await inspectBackupRetention(new Storage(), backupTarget(process.env))
    console.log(JSON.stringify(result))
    if (!result.retentionSatisfied || !result.dailyFreshEnough || !result.weeklyFreshEnough || result.reviewRequired) process.exitCode = 1
  } catch {
    console.error('Backup inventory failed; inspect the target, access, and inventory before acting.')
    process.exitCode = 1
  }
}
