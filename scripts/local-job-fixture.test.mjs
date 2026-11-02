import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateFixtureUrl } from './local-job-fixture.mjs'

test('local job fixture refuses nonlocal and ambiguous database URLs', () => {
  const valid = 'postgres://idea_map:local-only@127.0.0.1:54329/idea_map_test_fixture'
  assert.equal(validateFixtureUrl(valid), valid)
  for (const value of [undefined, 'postgres://idea_map:x@host.example/idea_map_dev', 'postgres://idea_map:x@localhost:54329/idea_map_dev',
    'postgres://idea_map:x@127.0.0.1:5432/idea_map_dev', 'postgres://idea_map:x@127.0.0.1:54329/production',
    'postgres://idea_map:x@127.0.0.1:54329/idea_map_dev?host=remote.example', 'postgres://other:x@127.0.0.1:54329/idea_map_dev']) {
    assert.throws(() => validateFixtureUrl(value), /local/)
  }
})
