import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { backupTarget, verifyBackupBucket } from './export-encrypted-backup.mjs'
import { parseBackupProviderTime, planBackupRetention } from './plan-backup-retention.mjs'

const backupObjectPattern = /^(daily|weekly|completion)\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(pgdump|complete)$/

// Bounding this wait does not cancel an SDK request already in flight.
async function beforeDeadline(deadline, action) {
  const remaining = Math.ceil(deadline - performance.now())
  if (remaining < 1) throw new Error('Backup inventory timed out')
  let timer
  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Backup inventory timed out')), remaining) }),
    ])
    if (performance.now() >= deadline) throw new Error('Backup inventory timed out')
    return result
  } finally {
    clearTimeout(timer)
  }
}

async function listAll(bucket, bucketName, query, deadline) {
  const items = []
  const tokens = new Set()
  let next = { ...query, autoPaginate: false, maxResults: 1000 }
  let pages = 0
  while (next) {
    if (++pages > 100) throw new Error('Inventory has too many pages')
    const [page, following] = await beforeDeadline(deadline, () => bucket.getFiles(next))
    if (page.some(file => !file.metadata?.name?.startsWith(query.prefix))) throw new Error('Inventory prefix is ambiguous')
    if (page.some(file => file.metadata?.bucket !== bucketName)) throw new Error('Inventory bucket is ambiguous')
    // Provider objects may be reused or mutated while subsequent pages load.
    items.push(...page.map(file => structuredClone(file.metadata)))
    if (items.length > 100_000) throw new Error('Inventory is too large')
    if (!following) break
    if (typeof following.pageToken !== 'string' || !following.pageToken || tokens.has(following.pageToken)) throw new Error('Inventory pagination is ambiguous')
    tokens.add(following.pageToken)
    next = { ...query, autoPaginate: false, maxResults: 1000, pageToken: following.pageToken }
  }
  return items
}

// Two matching observations detect changes during listing, but cannot prove
// completeness or replace the independent writer and lifecycle fences.
function inventoryFingerprint(objects) {
  return objects.map(object => JSON.stringify([
    object.name, object.bucket, object.generation, object.metageneration, object.timeCreated, object.timeDeleted,
    object.softDeleteTime, object.hardDeleteTime, object.size, object.crc32c,
    object.eventBasedHold, object.temporaryHold, object.retentionExpirationTime,
    object.retention?.mode, object.retention?.retainUntilTime,
    Object.entries(object.metadata ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ])).sort()
}

/** Match each archive to a create-only completion record; never count orphan records. */
export function confirmCompletedExports(objects, environment, now, bucketIdentity) {
  const prefix = `idea-map-v2/${environment}/`
  const names = new Set()
  const snapshots = new Map()
  const number = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
  const crc = value => typeof value === 'string' && /^[A-Za-z0-9+/]{6}==$/.test(value)
  for (const object of objects) {
    if (!object.name?.startsWith(prefix) || names.has(object.name) || object.timeDeleted !== undefined) throw new Error('Backup generations are ambiguous')
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
  let legacyCompletions = 0
  for (const [snapshot, group] of snapshots) {
    const marker = group.completion
    if (!marker) throw new Error('Backup completion record is missing')
    const date = snapshot.slice(0, 10)
    const meta = marker.metadata ?? {}
    const startedAt = meta.backup_started_at
    const started = Date.parse(startedAt)
    const created = parseBackupProviderTime(marker.timeCreated)
    const hasWeekly = ['weekly_generation', 'weekly_size', 'weekly_crc32c'].some(key => meta[key] !== undefined)
    const legacy = meta.backup_version === '2'
    if ((!legacy && meta.backup_version !== '3') ||
        (!legacy && (!number(bucketIdentity?.generation) || !number(bucketIdentity?.metageneration) ||
          meta.bucket_generation !== bucketIdentity.generation || meta.bucket_metageneration !== bucketIdentity.metageneration)) ||
        typeof startedAt !== 'string' || !Number.isFinite(started) ||
        new Date(started).toISOString() !== startedAt || startedAt.slice(0, 10) !== date ||
        !created || created.nanoseconds < BigInt(started) * 1_000_000n || created.nanoseconds > BigInt(now.getTime()) * 1_000_000n ||
        marker.size !== '0' || marker.crc32c !== 'AAAAAA==' ||
        !number(meta.daily_generation) || !number(meta.daily_size) || !crc(meta.daily_crc32c) ||
        (new Date(started).getUTCDay() === 1 && !hasWeekly) ||
        (hasWeekly && (!number(meta.weekly_generation) || !number(meta.weekly_size) || !crc(meta.weekly_crc32c) ||
          meta.weekly_size !== meta.daily_size || meta.weekly_crc32c !== meta.daily_crc32c))) {
      throw new Error('Backup completion metadata is invalid')
    }
    if (legacy) legacyCompletions++
    for (const kind of ['daily', ...(hasWeekly ? ['weekly'] : [])]) {
      const archive = group[kind]
      if (!archive) {
        if (now.getTime() - created.ceilingMilliseconds < (kind === 'daily' ? 15 : 63) * 86_400_000) throw new Error('A recent completed archive is missing')
        continue
      }
      const archiveCreated = parseBackupProviderTime(archive.timeCreated)
      if (!archiveCreated || archiveCreated.nanoseconds < BigInt(started) * 1_000_000n || archiveCreated.nanoseconds > created.nanoseconds ||
          archive.generation !== meta[`${kind}_generation`] || archive.size !== meta[`${kind}_size`] || archive.crc32c !== meta[`${kind}_crc32c`]) {
        throw new Error('Backup archive differs from its completion record')
      }
      confirmed.push({ ...archive, bucketIdentityVerified: !legacy,
        metadata: { ...archive.metadata, backup_started_at: startedAt } })
    }
    if (group.weekly && !hasWeekly) throw new Error('Unexpected weekly backup')
    if (!group.daily && !group.weekly) orphanCompletions++
  }
  return { confirmed, orphanCompletions, legacyCompletions }
}

/** Inspect all live, noncurrent, and soft-deleted backup generations; never delete. */
export async function inspectBackupRetention(storage, target, now, options = {}) {
  const timeoutMs = options?.timeoutMs ?? 60_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid inventory timeout')
  target = { environment: target?.environment, bucket: target?.bucket, projectNumber: target?.projectNumber }
  const deadline = performance.now() + timeoutMs
  const fixedTime = now !== undefined
  if (fixedTime) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid inventory time')
    now = new Date(now.getTime())
  }
  const bucket = storage.bucket(target.bucket)
  const [metadata] = await beforeDeadline(deadline, () => bucket.getMetadata())
  // Disabled soft delete prevents listing generations retained under an older policy.
  if (metadata?.softDeletePolicy?.retentionDurationSeconds === '0' || metadata?.softDeletePolicy?.retentionDurationSeconds === 0) {
    throw new Error('Soft-deleted inventory cannot be verified')
  }
  verifyBackupBucket(metadata, target)
  if (typeof metadata.generation !== 'string' || !/^[1-9][0-9]*$/.test(metadata.generation) ||
      typeof metadata.metageneration !== 'string' || !/^[1-9][0-9]*$/.test(metadata.metageneration)) {
    throw new Error('Backup bucket identity is ambiguous')
  }
  const bucketIdentity = { generation: metadata.generation, metageneration: metadata.metageneration }
  const prefix = `idea-map-v2/${target.environment}/`
  // The bucket also contains recovery records. Never list or inspect them as backups.
  const backupPrefixes = ['daily', 'weekly', 'completion'].map(kind => `${prefix}${kind}/`)
  const objects = (await Promise.all(backupPrefixes.map(objectPrefix => listAll(bucket, target.bucket, { prefix: objectPrefix, versions: true }, deadline)))).flat()
  const softDeleted = (await Promise.all(backupPrefixes.map(objectPrefix => listAll(bucket, target.bucket, { prefix: objectPrefix, softDeleted: true }, deadline)))).flat()
  const observedObjects = (await Promise.all(backupPrefixes.map(objectPrefix => listAll(bucket, target.bucket, { prefix: objectPrefix, versions: true }, deadline)))).flat()
  const observedSoftDeleted = (await Promise.all(backupPrefixes.map(objectPrefix => listAll(bucket, target.bucket, { prefix: objectPrefix, softDeleted: true }, deadline)))).flat()
  const [observedBucket] = await beforeDeadline(deadline, () => bucket.getMetadata())
  verifyBackupBucket(observedBucket, target)
  if (bucketIdentity.generation !== observedBucket.generation || bucketIdentity.metageneration !== observedBucket.metageneration ||
      JSON.stringify(inventoryFingerprint(objects)) !== JSON.stringify(inventoryFingerprint(observedObjects)) ||
      JSON.stringify(inventoryFingerprint(softDeleted)) !== JSON.stringify(inventoryFingerprint(observedSoftDeleted))) {
    throw new Error('Backup inventory changed')
  }
  if (performance.now() >= deadline) throw new Error('Backup inventory timed out')
  now ??= new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid inventory time')
  const observedNanoseconds = BigInt(now.getTime()) * 1_000_000n
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
      if (object.timeDeleted === undefined) { completions.push(object); continue }
      const created = parseBackupProviderTime(object.timeCreated)
      const deleted = parseBackupProviderTime(object.timeDeleted)
      if (!created || !deleted || deleted.nanoseconds < created.nanoseconds || deleted.nanoseconds > observedNanoseconds) throw new Error('Completion record state is ambiguous')
      pendingCompletions.push({ ...object, timeDeleted: undefined })
      continue
    }
    if (object.timeDeleted === undefined) { live.push(object); continue }
    const created = parseBackupProviderTime(object.timeCreated)
    const deletion = parseBackupProviderTime(object.timeDeleted)
    const minimum = object.name?.includes('/daily/') ? 15 : object.name?.includes('/weekly/') ? 63 : Infinity
    if (!created || !deletion || now.getTime() - created.ceilingMilliseconds < minimum * 86_400_000 ||
        deletion.nanoseconds < created.nanoseconds || deletion.nanoseconds > observedNanoseconds) throw new Error('Unexpected noncurrent backup')
    pending.push({ ...object, timeDeleted: undefined })
  }
  for (const object of softDeleted) {
    if (!object.name?.startsWith(prefix) || names.has(object.name)) throw new Error('Soft-deleted generations are ambiguous')
    const match = backupObjectPattern.exec(object.name.slice(prefix.length))
    const day = match && Date.parse(`${match[2]}T00:00:00.000Z`)
    const created = parseBackupProviderTime(object.timeCreated)
    const softDeletedAt = parseBackupProviderTime(object.softDeleteTime)
    const hardDeleteAt = parseBackupProviderTime(object.hardDeleteTime)
    if (!match || (match[1] === 'completion') !== (match[4] === 'complete') || !Number.isFinite(day) ||
        new Date(day).toISOString().slice(0, 10) !== match[2] || !created || !softDeletedAt || !hardDeleteAt ||
        softDeletedAt.nanoseconds < created.nanoseconds || softDeletedAt.nanoseconds > observedNanoseconds ||
        hardDeleteAt.nanoseconds <= softDeletedAt.nanoseconds ||
        created.nanoseconds < BigInt(day) * 1_000_000n || created.nanoseconds >= BigInt(day + 2 * 86_400_000) * 1_000_000n ||
        created.nanoseconds > observedNanoseconds ||
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
  const { confirmed, orphanCompletions, legacyCompletions } = confirmCompletedExports(
    [...live, ...pending, ...completions, ...pendingCompletions], target.environment, now, bucketIdentity)
  const liveNames = new Set(live.map(object => object.name))
  const confirmedLive = confirmed.filter(object => liveNames.has(object.name))
  const verifiedLive = confirmedLive.filter(object => object.bucketIdentityVerified)
  const plan = planBackupRetention({ environment: target.environment, complete: true, objects: confirmedLive, now })
  const latestDaily = verifiedLive.reduce((latest, object) => object.name.startsWith(`${prefix}daily/`)
    ? Math.max(latest, Date.parse(object.metadata.backup_started_at)) : latest, -Infinity)
  const latestWeekly = verifiedLive.reduce((latest, object) => object.name.startsWith(`${prefix}weekly/`)
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
  const longSoftDelete = softDeleted.filter(object => parseBackupProviderTime(object.hardDeleteTime).nanoseconds -
    parseBackupProviderTime(object.softDeleteTime).nanoseconds > 7n * 86_400_000n * 1_000_000n).length
  const overdueSoftDeletion = softDeleted.filter(object => parseBackupProviderTime(object.hardDeleteTime).nanoseconds <=
    BigInt(evaluatedAt.getTime()) * 1_000_000n).length
  // The validated date in an archive name is no later than the backup start.
  // Use it even for soft-deleted copies whose completion record may be gone.
  const earliestStart = object => Date.parse(`${backupObjectPattern.exec(object.name.slice(prefix.length))[2]}T00:00:00.000Z`)
  const expiryAttentionPending = pending.filter(object => now.getTime() - earliestStart(object) >= 69 * 86_400_000).length
  const expiryAttentionSoftDeleted = softDeleted.filter(object => !object.name.startsWith(`${prefix}completion/`) &&
    now.getTime() - earliestStart(object) >= 69 * 86_400_000).length
  const reviewRequired = legacyCompletions > 0 || plan.oldOrHeld > 0 || oldPendingArchives > 0 || oldSoftDeleted > 0 || plan.expiryAttention > 0 ||
    expiryAttentionPending > 0 || expiryAttentionSoftDeleted > 0 || longSoftDelete > 0 || overdueSoftDeletion > 0
  const retentionSatisfied = plan.retentionSatisfied && legacyCompletions === 0
  return { ...plan, retentionSatisfied, candidates: retentionSatisfied && dailyFreshEnough && weeklyFreshEnough ? plan.candidates : [],
    dailyFreshEnough, latestDailyAgeSeconds, weeklyFreshEnough, latestWeeklyAgeSeconds,
    pendingLifecycle: pending.length, pendingCompletions: pendingCompletions.length, orphanCompletions, legacyCompletions,
    softDeleted: softDeleted.length, oldSoftDeleted, longSoftDelete, overdueSoftDeletion, oldPendingArchives,
    expiryAttentionPending, expiryAttentionSoftDeleted, reviewRequired }
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
