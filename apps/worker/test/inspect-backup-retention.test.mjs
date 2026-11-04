import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmCompletedExports, inspectBackupRetention } from '../ops/inspect-backup-retention.mjs'

const target = { environment: 'dev', bucket: 'synthetic-backups', projectNumber: '123456789' }
const now = new Date('2026-11-03T12:00:00Z')
const metadata = { name: target.bucket, projectNumber: target.projectNumber,
  iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
  versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }
const make = (kind, days) => {
  const timeCreated = new Date(now.getTime() - days * 86_400_000).toISOString()
  return { name: `idea-map-v2/dev/${kind}/${timeCreated.slice(0, 10)}/00000000-0000-4000-8000-${String(days).padStart(12, '0')}.pgdump`,
    generation: String(days + 1), metageneration: '1', timeCreated, size: '100', crc32c: 'AAAAAA==' }
}
const softDeletedObject = object => ({ ...object,
  softDeleteTime: new Date(now.getTime() - 86_400_000).toISOString(),
  hardDeleteTime: new Date(now.getTime() + 6 * 86_400_000).toISOString() })
const completion = (daily, weekly) => ({
  name: daily.name.replace('/daily/', '/completion/').replace('.pgdump', '.complete'),
  generation: daily.generation, metageneration: '1', timeCreated: daily.timeCreated, size: '0', crc32c: 'AAAAAA==',
  metadata: { backup_version: '2', backup_started_at: daily.timeCreated,
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
  assert.equal(queries.length, 9)
  assert.equal(queries[0].versions, true)
  assert.equal(queries.filter(query => query.softDeleted).length, 3)
  assert.deepEqual(new Set(queries.map(query => query.prefix)), new Set(['daily', 'weekly', 'completion'].map(kind => `idea-map-v2/dev/${kind}/`)))
  assert.equal(result.softDeleted, 1)
  assert.equal(result.oldSoftDeleted, 1)
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
  assert.equal(result.reviewRequired, true)
})

test('an old soft-deleted completion marker is not counted as an old archive', async () => {
  const marker = completion(make('daily', 80), null)
  const objects = records.filter(item => now.getTime() - Date.parse(item.timeCreated) < 76 * 86_400_000)
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
  assert.throws(() => confirmCompletedExports(records.map(item => item === daily ? { ...item, generation: '9999' } : item), 'dev', now))
  assert.throws(() => confirmCompletedExports(records.map(item => item === weekly ? { ...item, crc32c: 'BBBBBB==' } : item), 'dev', now))
  assert.throws(() => confirmCompletedExports(records.filter(item => item !== daily), 'dev', now))
  const olderWeekly = records.find(item => item.name.includes('/weekly/') && now - Date.parse(item.timeCreated) >= 15 * 86_400_000)
  const expiredDaily = records.filter(item => item.name !== olderWeekly.name.replace('/weekly/', '/daily/'))
  assert.equal(confirmCompletedExports(expiredDaily, 'dev', now).confirmed.length, 87)
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
