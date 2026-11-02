import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createWorkerHandler } from '../dist/worker.js'

test('worker validates the audience and the separate caller for each route', async () => {
  let executions = 0
  let repairs = 0
  const origin = 'https://worker.example.invalid'
  const handler = createWorkerHandler({ origin, taskInvoker: 'task@example.invalid', repairInvoker: 'repair@example.invalid',
    async verify(token, audience) {
      assert.equal(audience, origin)
      if (token === 'bad-audience' || token === 'invalid') throw new Error('invalid token')
      return { email: token === 'task' ? 'task@example.invalid' : 'repair@example.invalid', verified: token !== 'unverified' }
    },
    async execute() { executions++; return 'completed' },
    async repair() { repairs++; return { attempted: 1, failed: 0 } },
  })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    const post = (path, token, body = '{"jobId":"11111111-1111-4111-8111-111111111111"}') => fetch(`${url}${path}`, {
      method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body,
    })
    assert.equal((await post('/tasks/execute', null)).status, 401)
    assert.equal((await post('/tasks/execute', 'bad-audience')).status, 401)
    assert.equal((await post('/tasks/execute', 'invalid')).status, 401)
    assert.equal((await post('/tasks/execute', 'repair')).status, 403)
    assert.equal((await post('/tasks/repair', 'task')).status, 403)
    assert.equal((await post('/tasks/repair', 'unverified')).status, 403)
    assert.equal((await post('/tasks/execute', 'task', '{}')).status, 400)
    assert.equal((await post('/tasks/execute', 'task', 'x'.repeat(2049))).status, 400)
    assert.equal((await post('/tasks/execute', 'task')).status, 204)
    assert.equal((await post('/tasks/repair', 'repair')).status, 204)
    assert.equal(executions, 1)
    assert.equal(repairs, 1)
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
