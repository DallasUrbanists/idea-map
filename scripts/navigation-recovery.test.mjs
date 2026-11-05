import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureBrowse, enterSubmitFromBrowse, openDetail, restoreNavigation, returnToBrowse
} from '../apps/web/app/utils/navigation-recovery.ts'

const context = () => ({ viewport: { latitude: 32.8, longitude: -96.8, zoom: 12.5 }, listOffset: 340 })

test('browse to detail and back preserves a copied viewport and list position', () => {
  const input = context()
  const before = structuredClone(input)
  const browse = captureBrowse(restoreNavigation(), input)
  const detail = openDetail(browse)
  input.viewport.zoom = 2
  assert.deepEqual(returnToBrowse(detail), { view: 'browse', browse: before, submitStep: null })
  assert.deepEqual(browse.browse, before)
  assert.notStrictEqual(detail.browse, browse.browse)
  assert.notStrictEqual(detail.browse.viewport, browse.browse.viewport)
})

test('history-like snapshots restore back and forward independently', () => {
  const browse = captureBrowse(restoreNavigation(), context())
  const detail = openDetail(browse)
  const newerBrowse = captureBrowse(returnToBrowse(detail), { ...context(), listOffset: 51 })
  assert.deepEqual(restoreNavigation(browse), browse)
  assert.deepEqual(restoreNavigation(detail), detail)
  assert.deepEqual(restoreNavigation(newerBrowse), newerBrowse)
  assert.equal(restoreNavigation(detail).browse.listOffset, 340)
  assert.equal(restoreNavigation(newerBrowse).browse.listOffset, 51)
})

test('invalid or missing snapshots and capture values are safe', () => {
  const empty = { view: 'browse', browse: null, submitStep: null }
  for (const value of [undefined, null, [], 'bad', 4, { view: 'unknown' }, { view: 'submit', submitStep: 'bad' }]) {
    assert.deepEqual(restoreNavigation(value), empty)
  }
  const valid = context()
  const invalid = [null, {}, { ...valid, viewport: null },
    { ...valid, listOffset: -1 }, { ...valid, listOffset: Infinity },
    ...['latitude', 'longitude', 'zoom'].flatMap(key => [NaN, Infinity, '1'].map(value => ({
      ...valid, viewport: { ...valid.viewport, [key]: value }
    }))),
    ...[{ latitude: 91 }, { latitude: -91 }, { longitude: 181 }, { longitude: -181 }, { zoom: -1 }].map(value => ({
      ...valid, viewport: { ...valid.viewport, ...value }
    }))]
  const state = captureBrowse(empty, valid)
  for (const value of invalid) {
    assert.deepEqual(captureBrowse(state, value), state)
    assert.deepEqual(restoreNavigation({ view: 'detail', browse: value }), { view: 'detail', browse: null, submitStep: null })
  }
  assert.deepEqual(captureBrowse(empty, { viewport: { latitude: -90, longitude: 180, zoom: 0 }, listOffset: 0 }).browse,
    { viewport: { latitude: -90, longitude: 180, zoom: 0 }, listOffset: 0 })
})

test('submit restarts at Locate without receiving or deleting an external draft', () => {
  const draft = Object.freeze({ content: 'synthetic draft sentinel' })
  const browse = captureBrowse(restoreNavigation(), context())
  let state = browse
  for (let i = 0; i < 3; i++) {
    state = enterSubmitFromBrowse(state)
    assert.equal(state.submitStep, 'locate')
    assert.deepEqual(restoreNavigation(state), state)
    state = returnToBrowse(state)
    assert.deepEqual(state, browse)
    assert.equal(draft.content, 'synthetic draft sentinel')
  }
  assert.deepEqual(enterSubmitFromBrowse(openDetail(browse)), openDetail(browse))
})

test('separate sessions and untrusted extra fields do not leak into snapshots', () => {
  const firstInput = context()
  Object.freeze(firstInput.viewport)
  Object.freeze(firstInput)
  const first = captureBrowse(restoreNavigation(), firstInput)
  const second = captureBrowse(restoreNavigation(), { ...context(), listOffset: 19 })
  const frozen = Object.freeze({ ...first, browse: Object.freeze({ ...first.browse, viewport: Object.freeze({ ...first.browse.viewport }) }) })
  assert.deepEqual(returnToBrowse(openDetail(frozen)), first)
  assert.equal(second.browse.listOffset, 19)
  assert.deepEqual(restoreNavigation({ ...first, draft: 'do not retain', browse: { ...first.browse, identity: 'do not retain' } }), first)
  assert.notStrictEqual(first.browse.viewport, second.browse.viewport)
})
