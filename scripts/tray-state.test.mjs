import test from 'node:test'
import assert from 'node:assert/strict'
import { trayMetrics, trayOffset, snapTray, allowedTrayRanks } from '../apps/web/app/composables/tray-state.ts'

test('v1 default states use closed, 320px medium and 520px maximum', () => {
  const metrics = trayMetrics(1000, 320, 520, 900)
  assert.deepEqual(metrics, { height: 520, mediumOffset: 200, scrollable: true })
  assert.deepEqual([0, 1, 2].map(rank => trayOffset(rank, metrics)), [520, 200, 0])
})
test('short content has no empty maximum or unnecessary scrolling', () => {
  const metrics = trayMetrics(200, 320, 520, 900)
  assert.deepEqual(metrics, { height: 200, mediumOffset: 0, scrollable: false })
  assert.deepEqual(allowedTrayRanks(1, false, true, true), [0, 1])
  assert.equal(snapTray(1, 0, metrics, true, true, -3, -24), 1)
})
test('slow releases choose the nearest allowed position', () => {
  const metrics = trayMetrics(1000, 320, 520, 900)
  assert.equal(snapTray(1, 240, metrics, true, true), 1)
  assert.equal(snapTray(1, 450, metrics, true, true), 0)
  assert.equal(snapTray(1, 40, metrics, true, true), 2)
})
test('directional flicks advance exactly one position and require distance and velocity', () => {
  const metrics = trayMetrics(1000, 320, 520, 900)
  assert.equal(snapTray(0, 0, metrics, true, true, -2, -200), 1)
  assert.equal(snapTray(1, 0, metrics, true, true, -2, -24), 2)
  assert.equal(snapTray(2, 520, metrics, true, true, 2, 200), 1)
  assert.equal(snapTray(1, 200, metrics, true, true, 2, 4), 1)
})
test('drag permissions prevent forbidden snap directions', () => {
  const metrics = trayMetrics(1000, 320, 520, 900)
  assert.equal(snapTray(1, 0, metrics, false, true, -2, -24), 1)
  assert.equal(snapTray(1, 520, metrics, true, false, 2, 24), 1)
  assert.deepEqual(allowedTrayRanks(1, true, false, false), [1])
})
test('viewport and invalid size limits remain finite and bounded', () => {
  assert.deepEqual(trayMetrics(1000, 320, 520, 200), { height: 200, mediumOffset: 0, scrollable: true })
  for (const invalid of [NaN, Infinity, -10, 0]) {
    const metrics = trayMetrics(invalid, invalid, invalid, invalid)
    assert.equal(Number.isFinite(metrics.height), true); assert.equal(metrics.height, 1)
  }
})
