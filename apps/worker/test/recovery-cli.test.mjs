import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('recovery CLI refuses missing confirmation and a mismatched queue without exposing database settings', () => {
  const queue = 'projects/synthetic-project/locations/us-central1/queues/jobs'
  const job = '11111111-1111-4111-8111-111111111111'
  const secret = 'synthetic-private-database-url'
  const env = { ...process.env, WORKER_PROVIDER_MODE: 'provider', CLOUD_TASKS_QUEUE: queue, WORKER_DATABASE_URL: secret }
  for (const args of [
    ['--queue', queue, '--job', job, '--generation', '0'],
    ['--queue', 'projects/other/locations/us-central1/queues/jobs', '--job', job, '--generation', '0', '--confirm-reviewed-recovery'],
    ['--queue', queue, '--job', job, '--generation', '-1', '--confirm-reviewed-recovery'],
  ]) {
    const result = spawnSync(process.execPath, ['dist/recover-cli.js', ...args], { env, encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 1)
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret))
  }
  const offline = spawnSync(process.execPath, ['dist/recover-cli.js', '--queue', queue, '--job', job, '--generation', '0', '--confirm-reviewed-recovery'],
    { env: { ...env, WORKER_PROVIDER_MODE: 'offline' }, encoding: 'utf8', timeout: 5000 })
  assert.equal(offline.status, 1)
  assert.match(offline.stderr, /WORKER_PROVIDER_MODE=provider/)
  assert.doesNotMatch(offline.stdout + offline.stderr, new RegExp(secret))
})
