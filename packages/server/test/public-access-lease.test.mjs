import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { acquirePublicAccessLease } from '../dist/public-access-lease.js'

test('a stalled liveness check aborts the lease and destroys its connection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const client = new EventEmitter()
  let destroyed
  client.release = value => { destroyed = value }
  client.query = async sql => {
    if (sql.includes('pg_catalog.pg_locks')) return new Promise(() => {})
    if (sql.includes('public_access_allowed')) return { rows: [{ is_open: true }] }
    return { rows: [] }
  }
  const lease = await acquirePublicAccessLease({ connect: async () => client })
  t.mock.timers.tick(250)
  await Promise.resolve()
  assert.equal(lease.signal.aborted, false)
  t.mock.timers.tick(9999)
  assert.equal(lease.signal.aborted, false)
  t.mock.timers.tick(1)
  assert.equal(lease.signal.aborted, true)
  await assert.rejects(lease.release(), /Public access unavailable/)
  assert.equal(destroyed, true)
})

test('a completed liveness check does not leave a deadline that aborts a healthy lease', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const client = new EventEmitter()
  let destroyed
  client.release = value => { destroyed = value }
  client.query = async sql => {
    if (sql.includes('pg_catalog.pg_locks')) return { rows: [{ is_open: true, closing: false }] }
    if (sql.includes('public_access_allowed')) return { rows: [{ is_open: true }] }
    return { rows: [] }
  }
  const lease = await acquirePublicAccessLease({ connect: async () => client })
  t.mock.timers.tick(250)
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(10_000)
  assert.equal(lease.signal.aborted, false)
  await lease.release()
  assert.equal(destroyed, false)
})

test('a late liveness response aborts even before a delayed timer runs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const client = new EventEmitter()
  let finishCheck, destroyed
  client.release = value => { destroyed = value }
  client.query = async sql => {
    if (sql.includes('pg_catalog.pg_locks')) return new Promise(resolve => { finishCheck = resolve })
    if (sql.includes('public_access_allowed')) return { rows: [{ is_open: true }] }
    return { rows: [] }
  }
  const lease = await acquirePublicAccessLease({ connect: async () => client })
  t.mock.timers.tick(250)
  await Promise.resolve()
  now = 10_001
  finishCheck({ rows: [{ is_open: true, closing: false }] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lease.signal.aborted, true)
  await assert.rejects(lease.release(), /Public access unavailable/)
  assert.equal(destroyed, true)
})

test('invalid liveness results and synchronous query errors fail closed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  for (const kind of ['malformed', 'throws']) {
    const client = new EventEmitter()
    let destroyed
    client.release = value => { destroyed = value }
    client.query = sql => {
      if (sql.includes('pg_catalog.pg_locks')) {
        if (kind === 'throws') throw new Error('synthetic query error')
        return Promise.resolve(null)
      }
      if (sql.includes('public_access_allowed')) return Promise.resolve({ rows: [{ is_open: true }] })
      return Promise.resolve({ rows: [] })
    }
    const lease = await acquirePublicAccessLease({ connect: async () => client })
    t.mock.timers.tick(250)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(lease.signal.aborted, true)
    await assert.rejects(lease.release(), /Public access unavailable/)
    assert.equal(destroyed, true)
  }
})

test('release before a scheduled check does not query a returned connection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const client = new EventEmitter()
  let checks = 0, destroyed
  client.release = value => { destroyed = value }
  client.query = async sql => {
    if (sql.includes('pg_catalog.pg_locks')) checks++
    if (sql.includes('public_access_allowed')) return { rows: [{ is_open: true }] }
    return { rows: [] }
  }
  const lease = await acquirePublicAccessLease({ connect: async () => client })
  t.mock.timers.tick(250)
  await lease.release()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 0)
  assert.equal(destroyed, false)
})

test('release destroys a connection with an in-flight liveness check', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const client = new EventEmitter()
  let destroyed, commits = 0
  client.release = value => { destroyed = value }
  client.query = async sql => {
    if (sql.includes('pg_catalog.pg_locks')) return new Promise(() => {})
    if (sql === 'COMMIT') commits++
    if (sql.includes('public_access_allowed')) return { rows: [{ is_open: true }] }
    return { rows: [] }
  }
  const lease = await acquirePublicAccessLease({ connect: async () => client })
  t.mock.timers.tick(250)
  await Promise.resolve()
  await lease.release()
  assert.equal(commits, 0)
  assert.equal(destroyed, true)
})

test('a stalled commit destroys the client rather than retaining the lease indefinitely', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const client = new EventEmitter()
  let destroyed
  client.release = value => { destroyed = value }
  client.query = async sql => {
    if (sql === 'COMMIT') return new Promise(() => {})
    if (sql.includes('public_access_allowed')) return { rows: [{ is_open: true }] }
    return { rows: [] }
  }
  const lease = await acquirePublicAccessLease({ connect: async () => client })
  const release = lease.release()
  t.mock.timers.tick(10_000)
  await assert.rejects(release, /Public access unavailable/)
  assert.equal(destroyed, true)
})
