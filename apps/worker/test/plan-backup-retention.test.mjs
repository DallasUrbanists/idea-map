import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planBackupRetention } from '../ops/plan-backup-retention.mjs'

const now = new Date('2026-11-03T12:00:00Z')
const object = (kind, days, extra = {}) => {
  const created = new Date(now.getTime() - days * 86_400_000)
  const date = created.toISOString().slice(0, 10)
  return { name: `idea-map-v2/dev/${kind}/${date}/00000000-0000-4000-8000-${String(days).padStart(12, '0')}.pgdump`,
    generation: String(days + 1), metageneration: '1', timeCreated: created.toISOString(), eventBasedHold: false, temporaryHold: false, ...extra }
}
const inventory = () => ({ environment: 'dev', complete: true, now,
  objects: [...Array.from({ length: 20 }, (_, i) => object('daily', i)), ...Array.from({ length: 11 }, (_, i) => object('weekly', i * 7))] })

test('retention preserves recent daily dates, weekly periods, grace, and holds', () => {
  const input = inventory()
  input.objects.push(object('daily', 40, { eventBasedHold: true }))
  input.objects.push(object('daily', 41, { retention: { mode: 'Locked', retainUntilTime: '2027-01-01T00:00:00Z' } }))
  const result = planBackupRetention(input)
  assert.equal(result.retentionSatisfied, true)
  assert.equal(result.privacyDeadlineVerified, false)
  assert.deepEqual(result.consecutive, { daily: true, weekly: true })
  const removed = new Set(result.candidates.map(row => row.name))
  assert.ok(!removed.has(object('daily', 14).name))
  assert.ok(removed.has(object('daily', 15).name))
  assert.ok(!removed.has(object('weekly', 56).name))
  assert.ok(removed.has(object('weekly', 63).name))
  assert.ok(!removed.has(object('daily', 40).name))
  assert.ok(!removed.has(object('daily', 41).name))
  assert.equal(result.oldOrHeld, 2)
})

test('a missing day prevents deletion even when older copies satisfy the count', () => {
  const input = inventory()
  input.objects = input.objects.filter(item => item.name !== object('daily', 3).name)
  const result = planBackupRetention(input)
  assert.ok(result.groupCounts.daily >= 14)
  assert.deepEqual(result.consecutive, { daily: false, weekly: true })
  assert.equal(result.retentionSatisfied, false)
  assert.deepEqual(result.candidates, [])
})

test('a missing week prevents deletion even when older copies satisfy the count', () => {
  const input = inventory()
  input.objects = input.objects.filter(item => item.name !== object('weekly', 7).name)
  const result = planBackupRetention(input)
  assert.ok(result.groupCounts.weekly >= 8)
  assert.deepEqual(result.consecutive, { daily: true, weekly: false })
  assert.equal(result.retentionSatisfied, false)
  assert.deepEqual(result.candidates, [])
})

test('stale upload times cannot yield candidates even with consecutive older groups', () => {
  const daily = inventory()
  const dailyBoundary = planBackupRetention({ ...daily, now: new Date(now.getTime() + 86_400_000) })
  assert.equal(dailyBoundary.retentionSatisfied, true)
  assert.ok(dailyBoundary.candidates.length > 0)
  const dailyStale = planBackupRetention({ ...daily, now: new Date(now.getTime() + 86_400_001) })
  assert.equal(dailyStale.retentionSatisfied, true)
  assert.deepEqual(dailyStale.candidates, [])
  const weekly = inventory()
  weekly.objects = weekly.objects.filter(item => item.name !== object('weekly', 0).name)
  const weeklyBoundary = planBackupRetention(weekly)
  assert.equal(weeklyBoundary.retentionSatisfied, true)
  assert.ok(weeklyBoundary.candidates.length > 0)
  const weeklyStale = planBackupRetention({ ...weekly, now: new Date(now.getTime() + 1) })
  assert.equal(weeklyStale.retentionSatisfied, true)
  assert.deepEqual(weeklyStale.candidates, [])
})

test('retention fails closed for insufficient, incomplete, ambiguous, or unexpected inventory', () => {
  const baseline = inventory()
  assert.throws(() => planBackupRetention({ ...baseline, complete: false }))
  const insufficient = planBackupRetention({ ...baseline, objects: baseline.objects.slice(0, 10) })
  assert.equal(insufficient.retentionSatisfied, false)
  assert.deepEqual(insufficient.groupCounts, { daily: 10, weekly: 0 })
  assert.deepEqual(insufficient.candidates, [])
  assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, baseline.objects[0]] }))
  assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, object('daily', 30, { timeDeleted: now.toISOString() })] }))
  for (const timeDeleted of [null, '']) {
    assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, object('daily', 30, { timeDeleted })] }), /Backup state is ambiguous/)
  }
  for (const field of ['softDeleteTime', 'hardDeleteTime']) {
    assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, object('daily', 30, { [field]: null })] }), /Backup state is ambiguous/)
  }
  assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, object('daily', 30, { name: 'other/backup' })] }))
  assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, object('daily', 30, { eventBasedHold: undefined })] }))
})

test('ambiguous object retention cannot produce expiry candidates', () => {
  for (const retention of [null, '', {}, { mode: 'Unknown', retainUntilTime: '2020-01-01T00:00:00Z' },
    { mode: 'Locked', retainUntilTime: null }, { mode: 'Unlocked', retainUntilTime: 'invalid' },
    { mode: 'Locked', retainUntilTime: '2020' }, { mode: 'Locked', retainUntilTime: '2026-02-30T00:00:00Z' }]) {
    const input = inventory()
    input.objects.push(object('daily', 30, { retention }))
    assert.throws(() => planBackupRetention(input), /Backup state is ambiguous/)
  }
  for (const retentionExpirationTime of [null, '', 0, 'invalid', '2020', '2026-02-30T00:00:00Z']) {
    const input = inventory()
    input.objects.push(object('daily', 30, { retentionExpirationTime }))
    assert.throws(() => planBackupRetention(input), /Backup state is ambiguous/)
  }
  const valid = inventory()
  const expired = object('daily', 30, { retention: { mode: 'Unlocked', retainUntilTime: '2020-02-29T02:30:00.123456789+02:00' } })
  valid.objects.push(expired)
  assert.ok(planBackupRetention(valid).candidates.some(candidate => candidate.name === expired.name))
})

test('sub-millisecond retention remains protected until the next whole millisecond', () => {
  const input = inventory()
  const objectRetention = object('daily', 30, { retention: { mode: 'Locked', retainUntilTime: '2026-11-03T12:00:00.000000001Z' } })
  const bucketRetention = object('daily', 31, { retentionExpirationTime: '2026-11-03T14:00:00.000000001+02:00' })
  input.objects.push(objectRetention, bucketRetention)
  const atDeadline = planBackupRetention(input)
  assert.equal(atDeadline.oldOrHeld, 2)
  assert.ok(atDeadline.candidates.every(candidate => ![objectRetention.name, bucketRetention.name].includes(candidate.name)))
  const afterDeadline = planBackupRetention({ ...input, now: new Date(now.getTime() + 1) })
  for (const item of [objectRetention, bucketRetention]) {
    assert.ok(afterDeadline.candidates.some(candidate => candidate.name === item.name))
  }
})

test('sub-millisecond creation time cannot satisfy the minimum age early', () => {
  const input = inventory()
  const name = object('daily', 15).name
  input.objects = input.objects.map(item => item.name === name
    ? { ...item, timeCreated: '2026-10-19T12:00:00.000000001Z' } : item)
  assert.ok(!planBackupRetention(input).candidates.some(candidate => candidate.name === name))
  assert.ok(planBackupRetention({ ...input, now: new Date(now.getTime() + 1) }).candidates.some(candidate => candidate.name === name))
})

test('sub-millisecond upload time cannot make stale backups appear fresh', () => {
  const input = inventory()
  const name = object('daily', 1).name
  input.objects = input.objects.filter(item => item.name !== object('daily', 0).name).map(item => item.name === name
    ? { ...item, timeCreated: '2026-11-02T12:00:00.000000001Z' } : item)
  assert.ok(planBackupRetention(input).candidates.length > 0)
  assert.deepEqual(planBackupRetention({ ...input, now: new Date(now.getTime() + 1) }).candidates, [])
})

test('expiry attention uses the earliest possible backup start, not upload completion', () => {
  const edge = object('daily', 69)
  const midnight = Date.parse(`${edge.name.split('/')[3]}T00:00:00.000Z`)
  const input = { environment: 'dev', complete: true, objects: [edge] }
  assert.equal(planBackupRetention({ ...input, now: new Date(midnight + 69 * 86_400_000 - 1) }).expiryAttention, 0)
  assert.equal(planBackupRetention({ ...input, now: new Date(midnight + 69 * 86_400_000) }).expiryAttention, 1)
})
