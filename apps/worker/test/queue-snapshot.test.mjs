import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readQueueSnapshot } from '../dist/queue-snapshot.js'

const queue = 'projects/synthetic/locations/us-central1/queues/jobs'
const now = new Date('2026-11-03T12:00:00Z')

test('queue snapshot reads basic pages and returns only aggregate ages', async () => {
  const paths = []
  const transport = { async request(method, path) {
    paths.push(path)
    assert.equal(method, 'GET')
    return { status: 200, data: paths.length === 1
      ? { tasks: [{ createTime: '2026-11-03T11:00:00Z', scheduleTime: '2026-11-03T11:30:00Z' }], nextPageToken: 'next' }
      : { tasks: [{ createTime: '2026-11-03T10:00:00Z', scheduleTime: '2026-11-04T10:00:00Z' }] } }
  } }
  assert.deepEqual(await readQueueSnapshot(transport, queue, now), { observed_at: now.toISOString(), count: 2,
    oldest_seconds: 7200, due: 1, oldest_due_seconds: 1800 })
  const query = new URLSearchParams(paths[0].split('?')[1])
  assert.equal(query.get('responseView'), 'BASIC')
  assert.equal(query.get('fields'), 'tasks(createTime,scheduleTime),nextPageToken')
  assert.equal(new URLSearchParams(paths[1].split('?')[1]).get('pageToken'), 'next')
})

test('queue snapshot fails closed on errors, bad timestamps, and repeated pages', async () => {
  const transport = response => ({ async request() { return response } })
  await assert.rejects(readQueueSnapshot(transport({ status: 403, data: {} }), queue, now))
  await assert.rejects(readQueueSnapshot(transport({ status: 200, data: { tasks: [{ createTime: 'bad', scheduleTime: 'bad' }] } }), queue, now))
  await assert.rejects(readQueueSnapshot(transport({ status: 200, data: { nextPageToken: 'same' } }), queue, now))
  await assert.rejects(readQueueSnapshot(transport({ status: 200, data: {} }), 'invalid', now))
  assert.deepEqual(await readQueueSnapshot(transport({ status: 200, data: {} }), queue, now),
    { observed_at: now.toISOString(), count: 0, oldest_seconds: null, due: 0, oldest_due_seconds: null })
})

test('a task created during listing does not invalidate the completed observation', async () => {
  const transport = { async request() {
    await new Promise(resolve => setTimeout(resolve, 10))
    const created = new Date().toISOString()
    return { status: 200, data: { tasks: [{ createTime: created, scheduleTime: created }] } }
  } }
  const result = await readQueueSnapshot(transport, queue)
  assert.equal(result.count, 1)
  assert.equal(result.due, 1)
  assert.ok(result.oldest_seconds >= 0)
})

test('queue snapshot rejects malformed provider timestamps and accepts supported fractional precision', async () => {
  const one = (createTime, scheduleTime) => ({ async request() {
    return { status: 200, data: { tasks: [{ createTime, scheduleTime }] } }
  } })
  for (const invalid of ['0000-01-01T00:00:00Z', '2026-02-30T10:00:00Z', '2026-11-03 10:00:00Z',
    '2026-11-03T10:00:00.1Z', '2026-11-03T10:00:00+00:00']) {
    await assert.rejects(readQueueSnapshot(one(invalid, '2026-11-03T11:00:00Z'), queue, now))
    await assert.rejects(readQueueSnapshot(one('2026-11-03T10:00:00Z', invalid), queue, now))
  }
  for (const fraction of ['.000', '.000000', '.000000000']) {
    const result = await readQueueSnapshot(one(`2026-11-03T10:00:00${fraction}Z`,
      `2026-11-03T11:00:00${fraction}Z`), queue, now)
    assert.equal(result.oldest_seconds, 7200)
    assert.equal(result.oldest_due_seconds, 3600)
  }
})

test('queue snapshot preserves sub-millisecond observation boundaries', async () => {
  const one = (createTime, scheduleTime) => ({ async request() {
    return { status: 200, data: { tasks: [{ createTime, scheduleTime }] } }
  } })
  await assert.rejects(readQueueSnapshot(one('2026-11-03T12:00:00.000000001Z', '2026-11-03T12:00:00Z'), queue, now))
  const result = await readQueueSnapshot(one('2026-11-03T11:59:59.000000001Z', '2026-11-03T12:00:00.000000001Z'), queue, now)
  assert.equal(result.oldest_seconds, 1)
  assert.equal(result.due, 0)
  assert.equal(result.oldest_due_seconds, null)
})

test('queue snapshot retains a supplied observation time across provider waits', async () => {
  const selected = new Date(now)
  const transport = { async request() {
    selected.setUTCFullYear(2040)
    return { status: 200, data: { tasks: [{ createTime: '2026-11-03T11:00:00Z', scheduleTime: '2026-11-03T11:30:00Z' }] } }
  } }
  const result = await readQueueSnapshot(transport, queue, selected)
  assert.equal(result.observed_at, now.toISOString())
  assert.equal(result.oldest_seconds, 3600)
  await assert.rejects(readQueueSnapshot(transport, queue, new Date('invalid')), /Invalid queue snapshot target/)
})

test('queue snapshot times out even when the transport ignores its abort signal', async () => {
  let signal
  const transport = { request(_method, _path, _body, received) {
    signal = received
    return new Promise(() => {})
  } }
  await assert.rejects(readQueueSnapshot(transport, queue, now, 20), /timed out/)
  assert.equal(signal.aborted, true)
  await assert.rejects(readQueueSnapshot(transport, queue, now, 0), /invalid/i)
})
