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
    env: { ...process.env, PORT: String(port), WORKER_ORIGIN: 'https://worker.example.invalid',
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
