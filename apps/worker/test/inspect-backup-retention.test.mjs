import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmCompletedExports as confirmExports, inspectBackupRetention } from '../ops/inspect-backup-retention.mjs'

const target = { environment: 'dev', bucket: 'synthetic-backups', projectNumber: '123456789' }
const now = new Date('2026-11-03T12:00:00Z')
const metadata = { name: target.bucket, projectNumber: target.projectNumber, generation: '11', metageneration: '1',
  iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
  versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }
const confirmCompletedExports = (objects, environment, time) => confirmExports(objects, environment, time, metadata)
const make = (kind, days) => {
  const timeCreated = new Date(now.getTime() - days * 86_400_000).toISOString()
  return { name: `idea-map-v2/dev/${kind}/${timeCreated.slice(0, 10)}/00000000-0000-4000-8000-${String(days).padStart(12, '0')}.pgdump`,
    bucket: target.bucket, generation: String(days + 1), metageneration: '1', timeCreated, size: '100', crc32c: 'AAAAAA==' }
}
const softDeletedObject = object => ({ ...object,
  softDeleteTime: new Date(now.getTime() - 86_400_000).toISOString(),
  hardDeleteTime: new Date(now.getTime() + 6 * 86_400_000).toISOString() })
const completion = (daily, weekly) => ({
  name: daily.name.replace('/daily/', '/completion/').replace('.pgdump', '.complete'),
  bucket: target.bucket, generation: daily.generation, metageneration: '1', timeCreated: daily.timeCreated, size: '0', crc32c: 'AAAAAA==',
  metadata: { backup_version: '3', backup_started_at: daily.timeCreated,
    bucket_generation: metadata.generation, bucket_metageneration: metadata.metageneration,
    daily_generation: daily.generation, daily_size: daily.size, daily_crc32c: daily.crc32c,
    ...(weekly ? { weekly_generation: weekly.generation, weekly_size: weekly.size, weekly_crc32c: weekly.crc32c } : {}) },
})
const records = Array.from({ length: 77 }, (_, i) => {
  const daily = make('daily', i)
  const weekly = new Date(daily.timeCreated).getUTCDay() === 1 ? make('weekly', i) : null
  return [daily, ...(weekly ? [weekly] : []), completion(daily, weekly)]
}).flat()

// Model the provider's prefix filtering while retaining each test's pagination.
const storageFor = bucket => ({ bucket: () => ({
  getMetadata: () => bucket.getMetadata(),
  async getFiles(query) {
    const [page, next] = await bucket.getFiles(query)
    return [page.filter(file => file.metadata.name.startsWith(query.prefix)), next]
  },
}) })

test('inventory reads all pages and separately counts old soft-deleted objects', async () => {
  const queries = []
  const bucket = {
    async getMetadata() { return [metadata] },
    async getFiles(query) {
      queries.push(query)
      if (query.softDeleted) return [[{ metadata: softDeletedObject(make('daily', 80)) }], null]
      if (!query.pageToken) return [records.slice(0, 10).map(item => ({ metadata: item })), { pageToken: 'second' }]
      return [records.slice(10).map(item => ({ metadata: item })), null]
    },
  }
  const result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(queries.length, 18)
  assert.equal(queries[0].versions, true)
  assert.equal(queries.filter(query => query.softDeleted).length, 6)
  assert.deepEqual(new Set(queries.map(query => query.prefix)), new Set(['daily', 'weekly', 'completion'].map(kind => `idea-map-v2/dev/${kind}/`)))
  assert.equal(result.softDeleted, 1)
  assert.equal(result.oldSoftDeleted, 1)
  assert.equal(result.expiryAttentionSoftDeleted, 1)
  assert.ok(result.expiryAttention > 0)
  assert.equal(result.reviewRequired, true)
  assert.equal(result.latestDailyAgeSeconds, 0)
  assert.equal(result.dailyFreshEnough, true)
  assert.equal(result.latestWeeklyAgeSeconds, 86_400)
  assert.equal(result.weeklyFreshEnough, true)
  assert.ok(result.candidates.some(item => item.name === make('daily', 15).name))
  const boundary = await inspectBackupRetention(storageFor(bucket), target, new Date(now.getTime() + 86_400_000))
  assert.equal(boundary.dailyFreshEnough, true)
  const late = await inspectBackupRetention(storageFor(bucket), target, new Date(now.getTime() + 86_400_001))
  assert.equal(late.dailyFreshEnough, false)
  assert.deepEqual(late.candidates, [])
  const stale = await inspectBackupRetention(storageFor(bucket), target, new Date(now.getTime() + 5 * 86_400_000))
  assert.equal(stale.latestDailyAgeSeconds, 5 * 86_400)
  assert.equal(stale.dailyFreshEnough, false)
  assert.deepEqual(stale.candidates, [])
})

test('inventory refuses ambiguous retention metadata on an otherwise completed archive', async () => {
  const oldName = make('daily', 30).name
  const ambiguous = records.map(item => item.name === oldName
    ? { ...item, retention: { mode: 'unknown', retainUntilTime: '2020-01-01T00:00:00Z' } } : item)
  const bucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
    return query.softDeleted ? [[], null] : [ambiguous.map(item => ({ metadata: item })), null]
  } }
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now), /Backup state is ambiguous/)
})

test('inventory does not treat invalid deletion metadata as a live archive', async () => {
  for (const timeDeleted of [null, '']) {
    const oldName = make('daily', 30).name
    const ambiguous = records.map(item => item.name === oldName ? { ...item, timeDeleted } : item)
    const bucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
      return query.softDeleted ? [[], null] : [ambiguous.map(item => ({ metadata: item })), null]
    } }
    await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now), /Unexpected noncurrent backup/)
  }
})

test('inventory rejects changes to the bucket, live objects, or soft-deleted objects during listing', async () => {
  let bucketReads = 0
  const replacedBucket = { async getMetadata() {
    return [{ ...metadata, generation: ++bucketReads === 1 ? '11' : '12' }]
  }, async getFiles() { return [[], null] } }
  await assert.rejects(inspectBackupRetention(storageFor(replacedBucket), target, now), /inventory changed/)
  const sharedMetadata = { ...metadata }
  let sharedReads = 0
  const mutatedBucket = { async getMetadata() {
    if (++sharedReads === 2) sharedMetadata.metageneration = '2'
    return [sharedMetadata]
  }, async getFiles() { return [[], null] } }
  await assert.rejects(inspectBackupRetention(storageFor(mutatedBucket), target, now), /inventory changed/)
  const sharedObject = make('daily', 0)
  let sharedObjectReads = 0
  const mutatedObject = { async getMetadata() { return [metadata] }, async getFiles(query) {
    if (!query.prefix.endsWith('/daily/') || query.softDeleted) return [[], null]
    if (++sharedObjectReads === 2) sharedObject.metageneration = '2'
    return [[{ metadata: sharedObject }], null]
  } }
  await assert.rejects(inspectBackupRetention(storageFor(mutatedObject), target, now), /inventory changed/)

  for (const changedSoftDelete of [false, true]) {
    const counts = new Map()
    const bucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
      const key = `${query.prefix}:${Boolean(query.softDeleted)}`
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      const isDaily = query.prefix.endsWith('/daily/')
      if (!isDaily || Boolean(query.softDeleted) !== changedSoftDelete) return [[], null]
      const object = changedSoftDelete ? softDeletedObject(make('daily', 80)) : make('daily', 0)
      return [[{ metadata: count === 1 ? object : { ...object, metageneration: '2' } }], null]
    } }
    await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now), /inventory changed/)
  }
})

test('inventory retains its selected target and observation time while listing', async () => {
  const selection = { ...target }
  const observed = new Date(now)
  const bucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
    return [query.softDeleted ? [] : records.map(item => ({ metadata: item })), null]
  } }
  const result = inspectBackupRetention(storageFor(bucket), selection, observed)
  selection.bucket = 'synthetic-wrong-bucket'
  selection.projectNumber = '999999999'
  selection.environment = 'prod'
  observed.setUTCFullYear(2040)
  assert.equal((await result).latestDailyAgeSeconds, 0)
})

test('inventory refuses unexpected bucket policy or an incomplete listing', async () => {
  const badBucket = { async getMetadata() { return [{ ...metadata, projectNumber: '999999999' }] } }
  await assert.rejects(inspectBackupRetention({ bucket: () => badBucket }, target, now))
  const looping = { async getMetadata() { return [metadata] },
    async getFiles() { return [[], { pageToken: 'repeated' }] } }
  await assert.rejects(inspectBackupRetention({ bucket: () => looping }, target, now))
  const wrongPrefix = { async getMetadata() { return [metadata] }, async getFiles() {
    return [[{ metadata: { name: 'idea-map-v2/dev/recovery-journal/synthetic' } }], null]
  } }
  await assert.rejects(inspectBackupRetention({ bucket: () => wrongPrefix }, target, now), /prefix is ambiguous/)
  for (const softDeleted of [false, true]) {
    for (const reportedBucket of ['synthetic-wrong-bucket', undefined]) {
      const wrongObject = { ...make('daily', 80), bucket: reportedBucket }
      const wrongBucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
        return [Boolean(query.softDeleted) === softDeleted ? [{ metadata: wrongObject }] : [], null]
      } }
      await assert.rejects(inspectBackupRetention(storageFor(wrongBucket), target, now), /bucket is ambiguous/)
    }
  }
})

test('bootstrap inventory reports missing copies without proposing deletion', async () => {
  const bucket = { async getMetadata() { return [metadata] }, async getFiles() { return [[], null] } }
  const result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.retentionSatisfied, false)
  assert.deepEqual(result.groupCounts, { daily: 0, weekly: 0 })
  assert.equal(result.latestDailyAgeSeconds, null)
  assert.equal(result.dailyFreshEnough, false)
  assert.equal(result.latestWeeklyAgeSeconds, null)
  assert.equal(result.weeklyFreshEnough, false)
  assert.deepEqual(result.candidates, [])
})

test('an archive completed during listing is evaluated after it arrives', async () => {
  const timeCreated = new Date().toISOString()
  const bucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
    if (query.softDeleted) return [[], null]
    await new Promise(resolve => setTimeout(resolve, 15))
    const makeCurrent = kind => ({ ...make(kind, 0), timeCreated,
      name: make(kind, 0).name.replace(now.toISOString().slice(0, 10), timeCreated.slice(0, 10)) })
    const daily = makeCurrent('daily')
    const weekly = new Date(timeCreated).getUTCDay() === 1 ? makeCurrent('weekly') : null
    return [[daily, ...(weekly ? [weekly] : []), completion(daily, weekly)].map(item => ({ metadata: item })), null]
  } }
  const result = await inspectBackupRetention(storageFor(bucket), target)
  assert.equal(result.groupCounts.daily, 1)
  assert.equal(result.dailyFreshEnough, true)
  assert.ok(result.latestDailyAgeSeconds >= 0)
})

test('inventory recognizes old noncurrent versions without counting them as usable backups', async () => {
  const old = make('daily', 20)
  const objects = records.map(item => item.name === old.name ? { ...item, timeDeleted: now.toISOString() } : item)
  const bucket = { async getMetadata() { return [metadata] },
    async getFiles(query) { return [query.softDeleted ? [] : objects.map(item => ({ metadata: item })), null] } }
  const result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.pendingLifecycle, 1)
  assert.ok(!result.candidates.some(item => item.name === old.name))
  const impossible = records.map(item => item.name === old.name ? { ...item, timeDeleted: '2020-01-01T00:00:00.000Z' } : item)
  bucket.getFiles = async query => [query.softDeleted ? [] : impossible.map(item => ({ metadata: item })), null]
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now))
  const recent = make('daily', 1)
  const unsafe = records.map(item => item.name === recent.name ? { ...item, timeDeleted: now.toISOString() } : item)
  bucket.getFiles = async query => [query.softDeleted ? [] : unsafe.map(item => ({ metadata: item })), null]
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now))
})

test('an old noncurrent archive requires review even when the current retention counts are healthy', async () => {
  const old = make('daily', 76)
  const objects = records.map(item => item.name === old.name ? { ...item, timeDeleted: now.toISOString() } : item)
  const bucket = { async getMetadata() { return [metadata] },
    async getFiles(query) { return [query.softDeleted ? [] : objects.map(item => ({ metadata: item })), null] } }
  const result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.retentionSatisfied, true)
  assert.equal(result.dailyFreshEnough, true)
  assert.equal(result.oldOrHeld, 0)
  assert.equal(result.oldPendingArchives, 1)
  assert.equal(result.expiryAttentionPending, 1)
  assert.equal(result.reviewRequired, true)
})

test('an old soft-deleted completion marker is not counted as an old archive', async () => {
  const marker = completion(make('daily', 80), null)
  const objects = records.filter(item => now.getTime() - Date.parse(item.timeCreated) < 69 * 86_400_000)
  const bucket = { async getMetadata() { return [metadata] },
    async getFiles(query) { return [(query.softDeleted ? [softDeletedObject(marker)] : objects).map(item => ({ metadata: item })), null] } }
  const result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.softDeleted, 1)
  assert.equal(result.oldSoftDeleted, 0)
  assert.equal(result.reviewRequired, false)
  bucket.getFiles = async query => [(query.softDeleted ? [{ ...marker, name: marker.name.replace('/completion/', '/daily/').replace('.complete', '.unexpected') }] : objects).map(item => ({ metadata: item })), null]
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now), /Soft-deleted inventory is ambiguous/)
})

test('completion inventory rejects unfinished, altered, or mismatched copies', () => {
  assert.equal(confirmCompletedExports(records, 'dev', now).confirmed.length, 88)
  const daily = records.find(item => item.name.includes('/daily/'))
  const weekly = records.find(item => item.name.includes('/weekly/') && item.name.endsWith('.pgdump'))
  const marker = records.find(item => item.name === daily.name.replace('/daily/', '/completion/').replace('.pgdump', '.complete'))
  assert.throws(() => confirmCompletedExports(records.filter(item => item !== marker), 'dev', now))
  assert.throws(() => confirmCompletedExports(records.map(item => item === marker ? { ...item, metadata: {} } : item), 'dev', now))
  assert.throws(() => confirmCompletedExports(records.map(item => item === marker ? { ...item, metadata: { ...item.metadata, bucket_generation: '99' } } : item), 'dev', now))
  assert.throws(() => confirmCompletedExports(records.map(item => item === marker ? { ...item, metadata: { ...item.metadata, bucket_metageneration: '99' } } : item), 'dev', now))
  assert.throws(() => confirmCompletedExports(records.map(item => item === daily ? { ...item, generation: '9999' } : item), 'dev', now))
  assert.throws(() => confirmCompletedExports(records.map(item => item === weekly ? { ...item, crc32c: 'BBBBBB==' } : item), 'dev', now))
  assert.throws(() => confirmCompletedExports(records.filter(item => item !== daily), 'dev', now))
  const olderWeekly = records.find(item => item.name.includes('/weekly/') && now - Date.parse(item.timeCreated) >= 15 * 86_400_000)
  const expiredDaily = records.filter(item => item.name !== olderWeekly.name.replace('/weekly/', '/daily/'))
  assert.equal(confirmCompletedExports(expiredDaily, 'dev', now).confirmed.length, 87)
})

test('completion timestamps preserve provider precision and ordering', () => {
  const daily = make('daily', 2)
  const marker = completion(daily, null)
  const start = daily.timeCreated.slice(0, -5)
  const archive = { ...daily, timeCreated: `${start}.000000002Z` }
  const earlierMarker = { ...marker, timeCreated: `${start}.000000001Z` }
  assert.throws(() => confirmCompletedExports([archive, earlierMarker], 'dev', now), /differs/)
  const laterMarker = { ...marker, timeCreated: `${start}.000000003Z` }
  assert.equal(confirmCompletedExports([archive, laterMarker], 'dev', now).confirmed.length, 1)
  const current = make('daily', 0)
  const futureMarker = { ...completion(current, null), timeCreated: '2026-11-03T12:00:00.000000001Z' }
  assert.throws(() => confirmCompletedExports([current, futureMarker], 'dev', now), /invalid/)
  assert.equal(confirmCompletedExports([current, futureMarker], 'dev', new Date(now.getTime() + 1)).confirmed.length, 1)
})

test('a sub-millisecond completion time cannot shorten missing-archive grace', () => {
  const observed = new Date(now.getTime() + 86_400_000)
  const older = make('daily', 14)
  const marker = { ...completion(older, null), timeCreated: '2026-10-20T12:00:00.000000001Z' }
  assert.throws(() => confirmCompletedExports([marker], 'dev', observed), /recent completed archive/)
  assert.equal(confirmCompletedExports([marker], 'dev', new Date(observed.getTime() + 1)).orphanCompletions, 1)
})

test('legacy markers remain visible but cannot establish a verified retention plan', async () => {
  const marker = records.find(item => item.name.includes('/completion/'))
  const legacyMetadata = { ...marker.metadata, backup_version: '2' }
  delete legacyMetadata.bucket_generation
  delete legacyMetadata.bucket_metageneration
  const objects = records.map(item => item === marker ? { ...item, metadata: legacyMetadata } : item)
  const bucket = { async getMetadata() { return [metadata] },
    async getFiles(query) { return [query.softDeleted ? [] : objects.map(item => ({ metadata: item })), null] } }
  const result = await inspectBackupRetention(storageFor(bucket), target, new Date(now.getTime() + 1))
  assert.equal(result.legacyCompletions, 1)
  assert.equal(result.retentionSatisfied, false)
  assert.equal(result.reviewRequired, true)
  assert.equal(result.dailyFreshEnough, false)
  assert.equal(result.latestDailyAgeSeconds, 86_400.001)
  assert.deepEqual(result.candidates, [])
  const weeklyMarker = records.find(item => item.name.includes('/completion/') && item.metadata.weekly_generation)
  const legacyWeekly = { ...weeklyMarker.metadata, backup_version: '2' }
  delete legacyWeekly.bucket_generation
  delete legacyWeekly.bucket_metageneration
  const weeklyObjects = records.map(item => item === weeklyMarker ? { ...item, metadata: legacyWeekly } : item)
  bucket.getFiles = async query => [query.softDeleted ? [] : weeklyObjects.map(item => ({ metadata: item })), null]
  const weeklyResult = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(weeklyResult.legacyCompletions, 1)
  assert.equal(weeklyResult.weeklyFreshEnough, false)
  assert.ok(weeklyResult.latestWeeklyAgeSeconds > 7 * 86_400)
  assert.deepEqual(weeklyResult.candidates, [])
  const allLegacy = records.map(item => {
    if (!item.name.includes('/completion/')) return item
    const oldMetadata = { ...item.metadata, backup_version: '2' }
    delete oldMetadata.bucket_generation
    delete oldMetadata.bucket_metageneration
    return { ...item, metadata: oldMetadata }
  })
  bucket.getFiles = async query => [query.softDeleted ? [] : allLegacy.map(item => ({ metadata: item })), null]
  const legacyOnly = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(legacyOnly.latestDailyAgeSeconds, null)
  assert.equal(legacyOnly.latestWeeklyAgeSeconds, null)
  assert.equal(legacyOnly.dailyFreshEnough, false)
  assert.equal(legacyOnly.weeklyFreshEnough, false)
  assert.equal(legacyOnly.retentionSatisfied, false)
  assert.equal(legacyOnly.reviewRequired, true)
  assert.deepEqual(legacyOnly.candidates, [])
})

test('an old completion record can outlive its archive without being counted as a backup', async () => {
  const old = make('daily', 20)
  const objects = records.filter(item => item.name !== old.name)
  const bucket = { async getMetadata() { return [metadata] },
    async getFiles(query) { return [query.softDeleted ? [] : objects.map(item => ({ metadata: item })), null] } }
  const result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.orphanCompletions, 1)
  assert.ok(!result.candidates.some(item => item.name === old.name))
  const markerName = old.name.replace('/daily/', '/completion/').replace('.pgdump', '.complete')
  const cleanup = objects.map(item => item.name === markerName ? { ...item, timeDeleted: now.toISOString() } : item)
  bucket.getFiles = async query => [query.softDeleted ? [] : cleanup.map(item => ({ metadata: item })), null]
  const pending = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(pending.pendingCompletions, 1)
  bucket.getFiles = async query => [query.softDeleted ? [{ metadata: softDeletedObject(old) }] : cleanup.map(item => ({ metadata: item })), null]
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now))
  const unsafe = records.map(item => item.name === markerName ? { ...item, timeDeleted: now.toISOString() } : item)
  bucket.getFiles = async query => [query.softDeleted ? [] : unsafe.map(item => ({ metadata: item })), null]
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now))
})

test('a missing archive uses completion time for the conservative grace period', () => {
  const observed = new Date('2026-11-04T12:00:00.000Z')
  const started = new Date(observed.getTime() - 15 * 86_400_000 - 60_000).toISOString()
  const daily = { ...make('daily', 15), timeCreated: started,
    name: make('daily', 15).name.replace(make('daily', 15).timeCreated.slice(0, 10), started.slice(0, 10)) }
  const marker = { ...completion(daily, null), timeCreated: new Date(Date.parse(started) + 120_000).toISOString() }
  assert.throws(() => confirmCompletedExports([marker], 'dev', observed))
  assert.equal(confirmCompletedExports([marker], 'dev', new Date(observed.getTime() + 120_000)).orphanCompletions, 1)
})

test('stale weekly backups suppress candidates even with fresh daily backups and consecutive older periods', async () => {
  const additional = Array.from({ length: 5 }, (_, index) => {
    const created = new Date(Date.parse('2026-11-04T23:59:00.000Z') + index * 86_400_000).toISOString()
    const daily = { ...make('daily', index),
      name: `idea-map-v2/dev/daily/${created.slice(0, 10)}/11111111-1111-4111-8111-${String(index).padStart(12, '0')}.pgdump`,
      timeCreated: created }
    return [daily, completion(daily, null)]
  }).flat()
  const objects = [...records, ...additional]
  const bucket = { async getMetadata() { return [metadata] },
    async getFiles(query) { return [query.softDeleted ? [] : objects.map(item => ({ metadata: item })), null] } }
  const atBoundary = await inspectBackupRetention(storageFor(bucket), target, new Date('2026-11-09T12:00:00.000Z'))
  assert.equal(atBoundary.retentionSatisfied, true)
  assert.equal(atBoundary.dailyFreshEnough, true)
  assert.equal(atBoundary.weeklyFreshEnough, true)
  assert.ok(atBoundary.candidates.length > 0)
  const stale = await inspectBackupRetention(storageFor(bucket), target, new Date('2026-11-09T12:00:00.001Z'))
  assert.equal(stale.retentionSatisfied, true)
  assert.equal(stale.dailyFreshEnough, true)
  assert.equal(stale.weeklyFreshEnough, false)
  assert.deepEqual(stale.candidates, [])
})

test('inventory bounds pagination even when each empty page supplies a new token', async () => {
  let pages = 0
  const bucket = { async getMetadata() { return [metadata] }, async getFiles() {
    pages++
    return [[], { pageToken: String(pages) }]
  } }
  await assert.rejects(inspectBackupRetention({ bucket: () => bucket }, target, now), /too many pages/)
  assert.ok(pages <= 300)
})

test('inventory bounds bucket and listing waits under a shared deadline', async () => {
  let listings = 0
  const stalledMetadata = { async getMetadata() { return new Promise(() => {}) },
    async getFiles() { listings++; return [[], null] } }
  await assert.rejects(inspectBackupRetention({ bucket: () => stalledMetadata }, target, now, { timeoutMs: 20 }), /timed out/)
  assert.equal(listings, 0)

  const stalledListing = { async getMetadata() { return [metadata] },
    async getFiles() { return new Promise(() => {}) } }
  await assert.rejects(inspectBackupRetention({ bucket: () => stalledListing }, target, now, { timeoutMs: 20 }), /timed out/)
  await assert.rejects(inspectBackupRetention({ bucket: () => stalledListing }, target, now, { timeoutMs: 0 }), /timeout/)

  let calls = 0
  const slowBoth = { async getMetadata() { await new Promise(resolve => setTimeout(resolve, 600)); return [metadata] },
    async getFiles() { calls++; await new Promise(resolve => setTimeout(resolve, 600)); return [[], null] } }
  await assert.rejects(inspectBackupRetention({ bucket: () => slowBoth }, target, now, { timeoutMs: 1000 }), /timed out/)
  assert.ok(calls > 0)
})

test('a disabled soft-delete policy cannot prove older retained versions are absent', async () => {
  let listed = false
  const bucket = { async getMetadata() {
    return [{ ...metadata, softDeletePolicy: { retentionDurationSeconds: '0' } }]
  }, async getFiles() { listed = true; return [[], null] } }
  await assert.rejects(inspectBackupRetention({ bucket: () => bucket }, target, now), /cannot be verified/)
  assert.equal(listed, false)
})

test('soft-deleted generations with old policy retention or overdue hard deletion require review', async () => {
  const object = softDeletedObject(make('daily', 80))
  const bucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
    return [(query.softDeleted ? [object] : records).map(item => ({ metadata: item })), null]
  } }
  object.hardDeleteTime = new Date(now.getTime() + 20 * 86_400_000).toISOString()
  let result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.longSoftDelete, 1)
  assert.equal(result.reviewRequired, true)
  object.softDeleteTime = new Date(now.getTime() - 8 * 86_400_000).toISOString()
  object.hardDeleteTime = new Date(now.getTime() - 1 * 86_400_000).toISOString()
  result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.overdueSoftDeletion, 1)
  assert.equal(result.reviewRequired, true)
  object.hardDeleteTime = 'invalid'
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now), /ambiguous/)
})

test('soft-delete ordering and retention preserve sub-millisecond provider precision', async () => {
  const object = softDeletedObject(make('daily', 80))
  const bucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
    return [(query.softDeleted ? [object] : records).map(item => ({ metadata: item })), null]
  } }
  object.softDeleteTime = '2026-10-27T12:00:00.000Z'
  object.hardDeleteTime = '2026-11-03T12:00:00.000000001Z'
  let result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.longSoftDelete, 1)
  assert.equal(result.overdueSoftDeletion, 0)
  object.hardDeleteTime = '2026-11-03T12:00:00.000Z'
  result = await inspectBackupRetention(storageFor(bucket), target, now)
  assert.equal(result.longSoftDelete, 0)
  assert.equal(result.overdueSoftDeletion, 1)
  object.softDeleteTime = '2026-11-03T12:00:00.000000001Z'
  object.hardDeleteTime = '2026-11-04T12:00:00.000Z'
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now), /ambiguous/)
  const start = object.timeCreated.slice(0, -5)
  object.timeCreated = `${start}.000000002Z`
  object.softDeleteTime = `${start}.000000001Z`
  await assert.rejects(inspectBackupRetention(storageFor(bucket), target, now), /ambiguous/)
})


test('soft-deleted copies get an early expiry warning even without their completion marker', async () => {
  const archived = make('daily', 68)
  const earliestStart = Date.parse(`${archived.name.split('/')[3]}T00:00:00.000Z`)
  const evaluated = new Date(earliestStart + 69 * 86_400_000)
  const soft = { ...archived, softDeleteTime: new Date(evaluated.getTime() - 86_400_000).toISOString(),
    hardDeleteTime: new Date(evaluated.getTime() + 6 * 86_400_000).toISOString() }
  const bucket = { async getMetadata() { return [metadata] }, async getFiles(query) {
    return [query.softDeleted ? [{ metadata: soft }] : [], null]
  } }
  const result = await inspectBackupRetention(storageFor(bucket), target, evaluated)
  assert.equal(result.expiryAttentionSoftDeleted, 1)
  assert.equal(result.reviewRequired, true)
})
