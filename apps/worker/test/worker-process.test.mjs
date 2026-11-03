import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'

test('worker responds to SIGTERM after it starts', async () => {
  const probe = createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const child = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, WORKER_PROVIDER_MODE: 'provider', PORT: String(port), WORKER_ORIGIN: 'https://worker.example.invalid',
      TASK_INVOKER_EMAIL: 'task@example.iam.gserviceaccount.com', REPAIR_INVOKER_EMAIL: 'repair@example.iam.gserviceaccount.com',
      CLOUD_TASKS_QUEUE: 'projects/test-project/locations/us-central1/queues/test',
      WORKER_DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:5432/unused' },
    stdio: 'ignore',
  })
  const exited = once(child, 'exit')
  try {
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200 } catch { /* still starting */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.ok(ready, 'worker must start')
    child.kill('SIGTERM')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000)
    const [code, signal] = await exited
    clearTimeout(timeout)
    assert.equal(signal, null)
    assert.equal(code, 0)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  }
})

test('offline worker refuses remote databases and disables provider authentication', async () => {
  const { spawnSync } = await import('node:child_process')
  const baseEnv = { ...process.env, WORKER_ORIGIN: 'https://worker.example.invalid',
    TASK_INVOKER_EMAIL: 'task@example.invalid', REPAIR_INVOKER_EMAIL: 'repair@example.invalid',
    WORKER_DATABASE_URL: 'postgres://synthetic:synthetic@127.0.0.1:5432/idea_map_test_modes' }
  for (const mode of ['', 'unknown']) {
    const failed = spawnSync(process.execPath, ['dist/index.js'], { env: { ...baseEnv, WORKER_PROVIDER_MODE: mode }, encoding: 'utf8', timeout: 5000 })
    assert.notEqual(failed.status, 0)
  }
  const remote = spawnSync(process.execPath, ['dist/index.js'], { env: { ...baseEnv, WORKER_PROVIDER_MODE: 'offline', WORKER_DATABASE_URL: 'postgres://synthetic:synthetic@remote.example.invalid/idea_map_dev' }, encoding: 'utf8', timeout: 5000 })
  assert.notEqual(remote.status, 0)
  assert.match(remote.stderr, /local development or disposable/)
  const probe = createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const child = spawn(process.execPath, ['dist/index.js'], { env: { ...baseEnv, WORKER_PROVIDER_MODE: 'offline',
    PORT: String(port), CLOUD_TASKS_QUEUE: '', GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/synthetic.json' }, stdio: 'ignore' })
  const exited = once(child, 'exit')
  try {
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200 } catch { /* still starting */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.ok(ready)
    const response = await fetch(`http://127.0.0.1:${port}/tasks/repair`, { method: 'POST', headers: { authorization: 'Bearer synthetic' } })
    assert.equal(response.status, 401)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited
  }
})
