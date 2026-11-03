import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateDesign } from '../packages/streetmix/dist/index.js'
import { createCloudTasksDispatcher, sendTransactionalEmail } from '../packages/server/dist/index.js'
import { createOfflineProviderFixtures, selectFixtureProvider } from './provider-fixtures.mjs'

test('provider mode is explicit and never falls back after a missing or failing adapter', async () => {
  let offlineCalls = 0
  const factories = { offline: () => { offlineCalls++; return 'offline' } }
  for (const mode of [undefined, '', 'other']) assert.throws(() => selectFixtureProvider(mode, factories), /Choose provider mode/)
  assert.throws(() => selectFixtureProvider('provider', factories), /not available/)
  assert.throws(() => selectFixtureProvider('provider', { provider: () => undefined }), /not available/)
  const error = new Error('provider unavailable')
  assert.throws(() => selectFixtureProvider('provider', { ...factories, provider: () => { throw error } }), cause => cause === error)
  assert.equal(offlineCalls, 0)
  assert.equal(selectFixtureProvider('offline', factories), 'offline')
  const provider = selectFixtureProvider('provider', { provider: () => ({ async create() { throw error } }) })
  await assert.rejects(generateDesign({ ideaId: 'synthetic', description: 'Synthetic', interpretationRevision: 'rev-1' },
    { plan: () => ({ name: 'Synthetic', segments: [] }) }, provider), cause => cause === error)
  assert.equal(offlineCalls, 1)
})

test('offline adapters exercise existing interfaces without external services', async () => {
  const fixture = createOfflineProviderFixtures()
  const design = selectFixtureProvider('offline', { offline: () => fixture.design })
  const input = { ideaId: 'synthetic', interpretationRevision: 'rev-1', description: 'Synthetic street' }
  const rules = { plan: () => ({ name: 'Synthetic street', segments: [{ kind: 'walkway', widthMeters: 2 }] }) }
  const first = await generateDesign(input, rules, design)
  assert.deepEqual(await generateDesign(input, rules, design), first)
  assert.equal(first.sourceRevision, 'rev-1')
  assert.notEqual((await generateDesign({ ...input, interpretationRevision: 'rev-2' }, rules, design)).designId, first.designId)
  const email = selectFixtureProvider('offline', { offline: () => fixture.email })
  const message = { from: 'sender@example.invalid', to: 'recipient@example.invalid', subject: 'Synthetic', text: 'Synthetic' }
  const sent = await sendTransactionalEmail(email, message, 'fixture-job')
  assert.equal(sent.status, 'accepted')
  assert.deepEqual(await sendTransactionalEmail(email, message, 'fixture-job'), sent)
  const queue = 'projects/synthetic-project/locations/us-central1/queues/jobs'
  const dispatcher = createCloudTasksDispatcher({ queue, workerOrigin: 'https://worker.example.invalid',
    invokerEmail: 'tasks@synthetic-project.iam.gserviceaccount.com', transport: fixture.tasks })
  const job = { id: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'synthetic', kind: 'moderation-deadline',
    revisionId: null, assessmentId: null, assessmentReceivedAt: null, scheduledAt: new Date('2030-01-01T00:00:00Z'), deliveryGeneration: 0 }
  const signal = new AbortController().signal
  await dispatcher.dispatch(job, signal)
  await dispatcher.dispatch(job, signal) // Duplicate is inspected by the real dispatcher.
  await assert.rejects(dispatcher.dispatch({ ...job, scheduledAt: new Date('2031-01-01T00:00:00Z') }, signal), /could not be verified/)
})
