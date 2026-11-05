import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { inspectSavedContent, inspectStoredSavedContent, savedContentKeys } from './v1-saved-content.mjs'

const fixture = (name, extension = 'json') => readFile(new URL(`./fixtures/v1-saved-content/${name}.${extension}`, import.meta.url), 'utf8')
const categories = ['bookmarks', 'actions', 'representatives']

test('empty and multi-item synthetic snapshots retain all parsed fields', async () => {
  for (const category of categories) {
    for (const variant of ['empty', 'multi']) {
      const raw = await fixture(`${category}-${variant}`)
      const result = inspectSavedContent(category, raw)
      assert.equal(result.status, 'ok')
      assert.equal(result.category, category)
      assert.equal(result.version, 1)
      assert.deepEqual(result.data, JSON.parse(raw))
      if (variant === 'multi') {
        assert.deepEqual(result.data.extraTop, { preserve: true })
        assert.equal(Object.hasOwn(result.data.saved, '__proto__'), true)
        assert.equal(Object.hasOwn(result.data.saved, 'constructor'), category !== 'representatives')
        assert.equal(({}).polluted, undefined)
        result.data.extraTop.preserve = false
        assert.equal(JSON.parse(raw).extraTop.preserve, true)
      }
    }
  }
})

test('malformed, missing, unsupported and invalid-entry fixtures fail without data', async () => {
  for (const category of categories) {
    assert.deepEqual(inspectSavedContent(category, null), { status: 'missing', category })
    assert.deepEqual(inspectSavedContent(category, await fixture('malformed', 'txt')), { status: 'invalid', category })
    assert.deepEqual(inspectSavedContent(category, await fixture(`${category}-unknown-version`)), { status: 'unsupported-version', category })
    assert.deepEqual(inspectSavedContent(category, await fixture(`${category}-invalid-entry`)), { status: 'invalid', category })
    for (const input of ['', 'null', '[]', '{}', '{"version":1}', 3, undefined]) {
      assert.deepEqual(inspectSavedContent(category, input), { status: 'invalid', category })
    }
  }
  for (const category of ['__proto__', 'constructor', 'other']) {
    assert.deepEqual(inspectSavedContent(category, '{"version":1}'), { status: 'unsupported-category' })
  }
})

test('timestamps, required fields and each action category are checked', async () => {
  for (const category of categories) {
    const baseline = JSON.parse(await fixture(`${category}-multi`))
    const first = Object.keys(baseline.saved)[0]
    for (const date of ['not-a-date', '', null, 0]) {
      const invalid = structuredClone(baseline)
      invalid.saved[first].savedAt = date
      assert.equal(inspectSavedContent(category, JSON.stringify(invalid)).status, 'invalid')
    }
    const missing = structuredClone(baseline)
    delete missing.saved[first].savedAt
    assert.equal(inspectSavedContent(category, JSON.stringify(missing)).status, 'invalid')
  }
  const bookmark = JSON.parse(await fixture('bookmarks-multi'))
  delete bookmark.saved.__proto__.suggestion.content.summary
  assert.equal(inspectSavedContent('bookmarks', JSON.stringify(bookmark)).status, 'invalid')
  const reps = JSON.parse(await fixture('representatives-multi'))
  delete reps.saved.__proto__.representative.id
  assert.equal(inspectSavedContent('representatives', JSON.stringify(reps)).status, 'invalid')
  const actions = JSON.parse(await fixture('actions-multi'))
  for (const mutate of [
    value => { delete value.saved.__proto__.action.instructions },
    value => { value.hidden.__proto__ = false },
    value => { delete value.generated.constructor.fingerprint },
    value => { value.generated.constructor.actions[0].sourceUrl = null },
    value => { value.saved = [] },
  ]) {
    const invalid = structuredClone(actions)
    mutate(invalid)
    assert.equal(inspectSavedContent('actions', JSON.stringify(invalid)).status, 'invalid')
  }
  // The predecessor reader does not require a saved-map key to equal action.key.
  assert.equal(inspectSavedContent('actions', JSON.stringify(actions)).status, 'ok')
})

test('the injected fake is read-only even on malformed data or read failure', async () => {
  for (const category of categories) {
    const raw = await fixture(`${category}-multi`)
    const entries = new Map([[savedContentKeys[category], raw], ['unrelated', 'unchanged']])
    let writes = 0
    const storage = {
      getItem(key) { return entries.has(key) ? entries.get(key) : null },
      setItem() { writes++; throw Error('unexpected write') },
      removeItem() { writes++; throw Error('unexpected remove') },
      clear() { writes++; throw Error('unexpected clear') },
    }
    const before = [...entries]
    assert.equal(inspectStoredSavedContent(category, storage).status, 'ok')
    entries.set(savedContentKeys[category], '{bad')
    const invalidBefore = [...entries]
    assert.equal(inspectStoredSavedContent(category, storage).status, 'invalid')
    assert.deepEqual([...entries], invalidBefore)
    entries.set(savedContentKeys[category], raw)
    storage.getItem = () => { throw Error('synthetic private error sentinel') }
    assert.deepEqual(inspectStoredSavedContent(category, storage), { status: 'read-error', category })
    assert.deepEqual([...entries], before)
    assert.equal(writes, 0)
  }
  let reads = 0
  const storage = { getItem() { reads++; return null } }
  assert.deepEqual(inspectStoredSavedContent('bookmarks', storage), { status: 'missing', category: 'bookmarks' })
  assert.deepEqual(inspectStoredSavedContent('__proto__', storage), { status: 'unsupported-category' })
  assert.equal(reads, 1)
})
