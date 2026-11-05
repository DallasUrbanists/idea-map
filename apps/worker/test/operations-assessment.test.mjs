import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assessOperations, operationsEvents } from '../dist/operations-assessment.js'
import { collectOperations } from '../dist/operations-monitor.js'
import { readOperationsSnapshot } from '../dist/operations-snapshot.js'

const limits = { backlogSeconds: 60, overdueSeconds: 120, queueSeconds: 300, emailEvents: 2, databaseBytes: '9007199254740993' }
const emptyDatabase = () => ({ public_access_open: true, database_size_bytes: '0', backlog: { unpublished: 0, oldest_seconds: null }, overdue: { count: 0, oldest_seconds: null },
  email: { failed: 0, bounced: 0, suppressed: 0, delayed: 0, complained: 0 } })
const emptyQueue = () => ({ count: 0, oldest_seconds: null, due: 0, oldest_due_seconds: null })

test('assessment identifies each breached threshold without emitting sensitive data', () => {
  const database = emptyDatabase()
  const queue = emptyQueue()
  assert.deepEqual(assessOperations(database, queue, limits), [])
  database.public_access_open = false
  assert.deepEqual(assessOperations(database, queue, limits), ['public_access_closed'])
  database.public_access_open = true
  database.backlog = { unpublished: 1, oldest_seconds: 60 }
  database.overdue = { count: 1, oldest_seconds: 120 }
  database.email.bounced = 2
  Object.assign(queue, { count: 2, oldest_seconds: 300, due: 1, oldest_due_seconds: 50 })
  assert.deepEqual(assessOperations(database, queue, limits), ['outbox_age', 'overdue_age', 'queue_age', 'email_events'])
  assert.deepEqual(operationsEvents(['queue_age']), [
    { severity: 'WARNING', event: 'operations_threshold_breached', signal: 'queue_age' },
    { severity: 'INFO', event: 'operations_assessment_completed' },
  ])
  assert.deepEqual(operationsEvents([]).map(event => event.event), ['operations_assessment_healthy', 'operations_assessment_completed'])
})

test('a recently created task that is already overdue is reported separately', () => {
  const database = emptyDatabase()
  const queue = { count: 1, oldest_seconds: 5, due: 1, oldest_due_seconds: 300 }
  assert.deepEqual(assessOperations(database, queue, limits), ['queue_due_age'])
})

test('database capacity uses exact byte comparisons above JavaScript safe integers', () => {
  const database = emptyDatabase()
  database.database_size_bytes = '9007199254740992'
  assert.deepEqual(assessOperations(database, emptyQueue(), limits), [])
  database.database_size_bytes = '9007199254740993'
  assert.deepEqual(assessOperations(database, emptyQueue(), limits), ['database_capacity'])
  database.database_size_bytes = '9223372036854775808'
  assert.throws(() => assessOperations(database, emptyQueue(), limits))
})

test('assessment refuses partial, inconsistent, or invalid observations and thresholds', () => {
  const database = emptyDatabase()
  const queue = emptyQueue()
  assert.throws(() => assessOperations(database, { ...queue, count: 1 }, limits))
  assert.throws(() => assessOperations(database, { ...queue, due: 1, oldest_due_seconds: 1 }, limits))
  assert.throws(() => assessOperations({ ...database, email: { ...database.email, failed: -1 } }, queue, limits))
  assert.throws(() => assessOperations({ ...database, public_access_open: null }, queue, limits))
  assert.throws(() => assessOperations({ ...database, backlog: { unpublished: 1, oldest_seconds: NaN } }, queue, limits))
  assert.throws(() => assessOperations(database, queue, { ...limits, queueSeconds: 0 }))
  assert.throws(() => assessOperations({ ...database, database_size_bytes: '01' }, queue, limits))
  assert.throws(() => assessOperations(database, queue, { ...limits, databaseBytes: '0' }))
  assert.throws(() => assessOperations(database, queue, { backlogSeconds: 1 }))
})

test('collector configuration failure is reported without exposing credentials', () => {
  const cli = fileURLToPath(new URL('../dist/operations-monitor-cli.js', import.meta.url))
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8', env: {
    ...process.env, OPERATIONS_DATABASE_URL: 'postgres://synthetic-secret@invalid.invalid/db',
    OPERATIONS_TASK_QUEUE: 'projects/synthetic/locations/region/queues/test', OPERATIONS_OUTBOX_AGE_SECONDS: '0',
  } })
  assert.equal(result.status, 1)
  assert.deepEqual(JSON.parse(result.stderr), { severity: 'ERROR', event: 'operations_collection_failed' })
  assert.doesNotMatch(result.stderr, /synthetic-secret/)
  assert.equal(result.stdout, '')
})

test('collector combines the existing snapshots and never completes a partial observation', async () => {
  let releases = 0
  const database = emptyDatabase()
  database.email.failed = 2
  database.database_size_bytes = '9007199254740992'
  const pool = { async connect() { return {
    async query(sql) { return sql.includes('WITH snapshot AS') ? { rows: [{ ...database, gate_open: true, guard_allowed: true }] } : { rows: [] } },
    release() { releases++ },
  } } }
  const queue = 'projects/synthetic/locations/us-central1/queues/test'
  const transport = { async request() { return { status: 200, data: {} } } }
  assert.deepEqual(await collectOperations(pool, transport, queue, limits), [
    { severity: 'INFO', event: 'operations_database_size_observed', database_size_bytes: '9007199254740992' },
    { severity: 'WARNING', event: 'operations_threshold_breached', signal: 'email_events' },
    { severity: 'INFO', event: 'operations_assessment_completed' },
  ])
  await assert.rejects(collectOperations(pool, { async request() { return { status: 403, data: {} } } }, queue, limits))
  assert.equal(releases, 2)
})

test('a failed snapshot discards a connection when rollback also fails', async () => {
  let released, rollbackAttempted = false
  const original = new Error('synthetic query failure')
  const pool = { async connect() { return {
    async query(sql) {
      if (sql.includes('WITH snapshot AS')) throw original
      if (sql === 'ROLLBACK') { rollbackAttempted = true; throw new Error('synthetic rollback failure') }
      return { rows: [] }
    },
    release(destroy) { released = destroy },
  } } }
  await assert.rejects(readOperationsSnapshot(pool), error => error === original)
  assert.equal(rollbackAttempted, true)
  assert.equal(released, true)
})
