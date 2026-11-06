import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeRecoveryIntent } from '../dist/recovery-journal-record.js'
import { suppressUnverifiedRestoredRemovals } from '../dist/recovery-suppression.js'

const ideaId = '22222222-2222-4222-8222-222222222222'
const intent = encodeRecoveryIntent({ operationId: '11111111-1111-4111-8111-111111111111', environment: 'dev',
  ideaId, actorId: '33333333-3333-4333-8333-333333333333', authorizedAt: '2026-11-03T12:00:00.000Z',
  decision: { kind: 'removal', classification: 'other', reason: 'synthetic private reason' } })

function fake({ result = { matched: 1, absent: 0 }, failAt, rollbackFails = false } = {}) {
  const statements = []
  let released
  const client = {
    async query(statement, parameters) {
      statements.push({ statement, parameters })
      if (statement === failAt || (statement === 'ROLLBACK' && rollbackFails)) throw new Error('synthetic private provider error')
      return { rows: statement.startsWith('SELECT * FROM public.suppress_restored_removals') ? [result] : [] }
    },
    release(destroy) { released = destroy },
  }
  return { pool: { async connect() { return client } }, statements, released: () => released }
}

test('suppression sends known removals and returns counts without asserting coverage', async () => {
  const state = fake()
  const result = await suppressUnverifiedRestoredRemovals(state.pool, [intent], 'dev')
  assert.deepEqual(result, { matched: 1, absent: 0, reviewOperations: 1, coverageVerified: false })
  assert.deepEqual(state.statements.map(item => item.statement), [
    'BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '10s'",
    'SELECT * FROM public.suppress_restored_removals($1::uuid[])', 'COMMIT',
  ])
  assert.deepEqual(state.statements[3].parameters, [[ideaId]])
  assert.equal(state.released(), false)
  assert.doesNotMatch(JSON.stringify(result), /synthetic|22222222/)
})

test('invalid inventory fails before the database is contacted', async () => {
  let connected = false
  const pool = { async connect() { connected = true; throw new Error('unexpected connection') } }
  await assert.rejects(suppressUnverifiedRestoredRemovals(pool, [intent, intent], 'dev'), /ambiguous/)
  assert.equal(connected, false)
})

test('ambiguous results or lost commits never report success and discard failed connections', async () => {
  const inconsistent = fake({ result: { matched: 0, absent: 0 } })
  await assert.rejects(suppressUnverifiedRestoredRemovals(inconsistent.pool, [intent], 'dev'), /outcome is uncertain/)
  assert.equal(inconsistent.statements.at(-1).statement, 'ROLLBACK')
  assert.equal(inconsistent.released(), false)
  const lost = fake({ failAt: 'COMMIT', rollbackFails: true })
  await assert.rejects(suppressUnverifiedRestoredRemovals(lost.pool, [intent], 'dev'), error =>
    error.message === 'Recovery suppression outcome is uncertain' && !error.message.includes('private'))
  assert.equal(lost.released(), true)
})
