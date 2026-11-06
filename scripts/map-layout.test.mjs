import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveMapLayout, mapOcclusion } from '../apps/web/app/composables/map-layout.ts'

for (const [width, height, finePointer, presentation, placement] of [
  [390, 844, false, 'app', 'bottom'], [844, 390, false, 'app', 'bottom'],
  [768, 1024, false, 'app', 'bottom'], [1024, 768, false, 'app', 'side'],
  [1366, 1024, false, 'app', 'side'], [1199, 900, true, 'app', 'side'],
  [1200, 900, true, 'desktop', 'side'], [1600, 1000, true, 'desktop', 'side'],
]) test(`adaptive geometry ${width}x${height}, fine pointer ${finePointer}`, () => {
  assert.deepEqual(resolveMapLayout({ width, height, finePointer }), { presentation, placement })
})
test('explicit overrides do not require pretending to identify the device', () => {
  assert.equal(resolveMapLayout({ width: 1440, height: 900, finePointer: true }, 'app').presentation, 'app')
  assert.equal(resolveMapLayout({ width: 768, height: 1024, finePointer: false }, 'desktop').presentation, 'desktop')
})
test('occlusion uses shell coordinates and clamps invalid geometry', () => {
  const shell = { top: 100, bottom: 900, left: 20, right: 1220, width: 1200, height: 800 }
  const search = { top: 116, bottom: 168, left: 116, right: 500, width: 384, height: 52 }
  const tray = { top: 580, bottom: 900, left: 20, right: 1220, width: 1200, height: 320 }
  assert.deepEqual(mapOcclusion(shell, tray, search, 0, 'bottom'), { top: 76, left: 0, right: 0, bottom: 320 })
  assert.deepEqual(mapOcclusion(shell, { ...tray, right: 500 }, search, 80, 'side'), { top: 76, left: 480, right: 0, bottom: 0 })
  assert.equal(mapOcclusion(shell, { ...tray, top: 856, height: 44 }, search, 0, 'bottom').bottom, 44)
  assert.equal(mapOcclusion(shell, { ...tray, height: 0, width: 0 }, search, 0, 'bottom').bottom, 0)
  assert.equal(mapOcclusion(shell, null, null, NaN, 'side').left, 0)
})
