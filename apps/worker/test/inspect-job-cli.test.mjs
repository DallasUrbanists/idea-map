import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('inspection rejects invalid targets and remote offline databases without exposing settings', () => {
  const secret = 'synthetic-private-database-url'
  for (const [args, database] of [
    [['--job', 'invalid'], secret],
    [['--job', '11111111-1111-4111-8111-111111111111'], 'postgres://user:synthetic-private-database-url@remote.invalid/idea_map_test_x'],
  ]) {
    const result = spawnSync(process.execPath, ['dist/inspect-job-cli.js', ...args], {
      env: { ...process.env, WORKER_PROVIDER_MODE: 'offline', WORKER_DATABASE_URL: database }, encoding: 'utf8', timeout: 5000,
    })
    assert.equal(result.status, 1)
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret))
  }
})
