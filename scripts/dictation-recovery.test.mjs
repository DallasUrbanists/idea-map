import assert from 'node:assert/strict'
import test from 'node:test'
import {
  startDictation, updateDictation, reviewDictation, applyDictation, discardDictation,
  undoDictation, serializeDictation, restoreDictation
} from '../apps/web/app/utils/dictation-recovery.ts'

function successful(result, status = 'ok') {
  assert.equal(result.status, status)
  return result.state
}

// The fake keeps the draft and serialized state together and checks the expected
// draft at commit time. It holds only synthetic data within each test instance.
function memoryStore(initial) {
  let draft = structuredClone(initial)
  let saved = null
  return {
    draft: () => structuredClone(draft),
    restore: () => restoreDictation(saved),
    save(state) { saved = serializeDictation(state); assert.notEqual(saved, null) },
    edit(next) { draft = structuredClone(next) },
    commit(result) {
      assert.equal(result.status, 'change')
      if (draft.text !== result.expected.text || draft.revision !== result.expected.revision) return false
      const serialized = serializeDictation(result.state)
      assert.notEqual(serialized, null)
      draft = structuredClone(result.draft)
      saved = serialized
      return true
    }
  }
}

function reviewed(draft, final = 'synthetic final') {
  let state = successful(startDictation(draft))
  state = successful(updateDictation(state, 'synthetic interim', final))
  return successful(reviewDictation(state))
}

test('review and apply keep the draft separate and undo survives refresh', () => {
  const original = Object.freeze({ text: 'synthetic original', revision: 'v1' })
  const store = memoryStore(original)
  let state = successful(startDictation(original))
  state = successful(updateDictation(state, 'synthetic interim', 'synthetic final'))
  assert.deepEqual(store.draft(), original)
  assert.notStrictEqual(state.original, original)
  store.save(state)
  state = store.restore()
  assert.equal(state.interim, 'synthetic interim')
  assert.equal(state.final, 'synthetic final')
  state = successful(reviewDictation(state))
  assert.deepEqual(successful(reviewDictation(state)), state)
  store.save(state)
  const result = applyDictation(store.restore(), store.draft(), 'synthetic original + synthetic final', 'v2')
  assert.equal(result.status, 'change')
  assert.deepEqual(store.draft(), original) // The caller has not committed the proposal.
  assert.notStrictEqual(result.draft, result.state.applied)
  assert.equal(store.commit(result), true)
  state = store.restore()
  assert.equal(state.phase, 'applied')
  assert.equal(applyDictation(state, store.draft(), 'duplicate', 'v3').status, 'unavailable')
  const undo = undoDictation(state, store.draft(), 'v3')
  assert.equal(store.commit(undo), true)
  assert.deepEqual(store.draft(), { text: original.text, revision: 'v3' })
  assert.equal(store.restore().phase, 'undone')
  assert.equal(undoDictation(store.restore(), store.draft(), 'v4').status, 'unavailable')
})

test('discard survives refresh and never changes an external draft', () => {
  const store = memoryStore({ text: 'synthetic draft', revision: 'a' })
  const state = reviewed(store.draft())
  store.save(state)
  const discarded = discardDictation(store.restore())
  store.save(successful(discarded))
  assert.deepEqual(store.restore(), { phase: 'discarded' })
  assert.deepEqual(store.draft(), { text: 'synthetic draft', revision: 'a' })
  assert.equal(discardDictation(store.restore()).status, 'ok')
  assert.equal(applyDictation(store.restore(), store.draft(), 'replacement', 'b').status, 'unavailable')
  assert.equal(undoDictation(store.restore(), store.draft(), 'b').status, 'unavailable')
})

test('conflicts and intervening edits cannot be silently replaced or undone', () => {
  const store = memoryStore({ text: 'original', revision: 'v1' })
  const state = reviewed(store.draft())
  store.save(state)
  store.edit({ text: 'unrelated edit', revision: 'v1' })
  assert.equal(applyDictation(store.restore(), store.draft(), 'replacement', 'v2').status, 'conflict')
  store.edit({ text: 'unrelated edit', revision: 'v2' })
  assert.equal(applyDictation(store.restore(), store.draft(), 'replacement', 'v3').status, 'conflict')
  store.edit({ text: 'original', revision: 'v3' }) // Same text with a newer version is still a conflict.
  assert.equal(applyDictation(store.restore(), store.draft(), 'replacement', 'v4').status, 'conflict')
  store.edit({ text: 'original', revision: 'v1' })
  const proposal = applyDictation(store.restore(), store.draft(), 'replacement', 'v4')
  store.edit({ text: 'late edit', revision: 'v5' })
  assert.equal(store.commit(proposal), false) // Compare-and-swap catches a later race.
  assert.deepEqual(store.draft(), { text: 'late edit', revision: 'v5' })
  store.edit({ text: 'original', revision: 'v1' })
  assert.equal(store.commit(applyDictation(store.restore(), store.draft(), 'replacement', 'v6')), true)
  store.edit({ text: 'replacement', revision: 'v7' })
  assert.equal(undoDictation(store.restore(), store.draft(), 'v8').status, 'conflict')
  store.edit({ text: 'replacement plus unrelated edit', revision: 'v7' })
  assert.equal(undoDictation(store.restore(), store.draft(), 'v8').status, 'conflict')
  assert.deepEqual(store.draft(), { text: 'replacement plus unrelated edit', revision: 'v7' })
})

test('empty transcripts, invalid transitions and malformed recovery fail safely', () => {
  const draft = { text: 'preserve this', revision: 'one' }
  for (const final of ['', '  \n']) {
    const state = reviewed(draft, final)
    assert.equal(applyDictation(state, draft, 'replacement', 'two').status, 'empty')
  }
  const state = reviewed(draft)
  assert.equal(applyDictation(state, draft, 'replacement', 'one').status, 'invalid')
  assert.equal(updateDictation(state, '', 'changed').status, 'unavailable')
  for (const saved of [null, undefined, '', '{', 'null', '[]', '{}', '{"phase":"review"}',
    JSON.stringify({ phase: 'review', original: draft, interim: 1, final: '' }),
    JSON.stringify({ phase: 'applied', original: draft, applied: { text: 'x', revision: 'one' } })]) {
    const restored = restoreDictation(saved)
    assert.equal(restored, null)
    assert.deepEqual(applyDictation(restored, draft, 'bad', 'two'), { status: 'invalid', state: null })
    assert.deepEqual(undoDictation(restored, draft, 'two'), { status: 'invalid', state: null })
    assert.deepEqual(draft, { text: 'preserve this', revision: 'one' })
  }
  assert.equal(serializeDictation({ phase: 'recording' }), null)
  assert.equal(startDictation({ text: 'x', revision: '' }).status, 'invalid')
})

test('sessions are independent and copies omit unrelated fields', () => {
  const first = { text: 'first', revision: 'a', privateExtra: 'discard me' }
  const second = { text: 'second', revision: 'b' }
  const a = successful(startDictation(first))
  const b = successful(startDictation(second))
  first.text = 'changed outside'
  assert.deepEqual(a.original, { text: 'first', revision: 'a' })
  assert.deepEqual(b.original, second)
  const aUpdated = successful(updateDictation(a, 'one', 'two'))
  assert.equal(b.final, '')
  assert.notStrictEqual(aUpdated.original, a.original)
  assert.doesNotMatch(serializeDictation(aUpdated), /discard me/)
})
