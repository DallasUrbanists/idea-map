import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { requireLocalTestDatabase } from './local-test-database.mjs'

const probe = `import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/packages/server/package.json');
const pg = require('pg'); pg.Pool = class { constructor() { throw new Error('UNEXPECTED_POOL_CONSTRUCTION') } };
globalThis.fetch = () => { throw new Error('UNEXPECTED_NETWORK_REQUEST') }`
const preload = `data:text/javascript,${encodeURIComponent(probe)}`
const paths = ['packages/server/test/registered-submissions.test.mjs', 'scripts/registered-submission-emulator.integration.mjs']
const invalid = [
  'postgres://synthetic:synthetic@127.0.0.1:5432/idea_map_test_safe?host=remote-host.invalid',
  'postgresql://synthetic:synthetic@localhost:5432/idea_map_test_safe?port=9999',
  'http://127.0.0.1:5432/idea_map_test_safe',
  'postgres://synthetic:synthetic@127.0.0.1:5432/idea_map_test_safe#fragment',
]

test('new submission test entry points reject ambiguous or non-Postgres URLs before creating a pool', () => {
  assert.equal(requireLocalTestDatabase('postgres://synthetic:synthetic@127.0.0.1:5432/idea_map_test_safe'), 'postgres://synthetic:synthetic@127.0.0.1:5432/idea_map_test_safe')
  assert.equal(requireLocalTestDatabase('postgresql://synthetic:synthetic@localhost:5432/idea_map_test_safe'), 'postgresql://synthetic:synthetic@localhost:5432/idea_map_test_safe')
  for (const value of invalid) {
    assert.throws(() => requireLocalTestDatabase(value), /local disposable test database/)
    for (const path of paths) {
      const env = { ...process.env, TEST_DATABASE_URL: value, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }
      delete env.NODE_TEST_CONTEXT
      const run = spawnSync(process.execPath, ['--import', preload, '--test', path], {
        encoding: 'utf8', timeout: 10000, env,
      })
      assert.equal(run.status, 1, `Expected guard failure in ${path}`)
      const output = `${run.stdout}\n${run.stderr}`
      assert.match(output, /local disposable test database/)
      assert.doesNotMatch(output, /UNEXPECTED_POOL_CONSTRUCTION|UNEXPECTED_NETWORK_REQUEST/)
    }
  }
  for (const path of paths) {
    const env = { ...process.env, TEST_DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:5432/idea_map_test_safe', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--import', preload, '--test', path], { encoding: 'utf8', timeout: 10000, env })
    assert.equal(run.status, 1, `Expected the pool probe to fire in ${path}`)
    assert.match(`${run.stdout}\n${run.stderr}`, /UNEXPECTED_POOL_CONSTRUCTION/)
  }
})
