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

test('retention fails closed for insufficient, incomplete, ambiguous, or unexpected inventory', () => {
  const baseline = inventory()
  assert.throws(() => planBackupRetention({ ...baseline, complete: false }))
  const insufficient = planBackupRetention({ ...baseline, objects: baseline.objects.slice(0, 10) })
  assert.equal(insufficient.retentionSatisfied, false)
  assert.deepEqual(insufficient.groupCounts, { daily: 10, weekly: 0 })
  assert.deepEqual(insufficient.candidates, [])
  assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, baseline.objects[0]] }))
  assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, object('daily', 30, { timeDeleted: now.toISOString() })] }))
  assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, object('daily', 30, { name: 'other/backup' })] }))
  assert.throws(() => planBackupRetention({ ...baseline, objects: [...baseline.objects, object('daily', 30, { eventBasedHold: undefined })] }))
})
