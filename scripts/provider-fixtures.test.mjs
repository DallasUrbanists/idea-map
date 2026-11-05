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

test('bounded task failures recover, preserve duplicates and expose only counts', async () => {
  const fixture = createOfflineProviderFixtures()
  const queue = 'projects/synthetic-project/locations/us-central1/queues/jobs'
  const dispatcher = createCloudTasksDispatcher({ queue, workerOrigin: 'https://worker.example.invalid',
    invokerEmail: 'tasks@synthetic-project.iam.gserviceaccount.com', transport: fixture.tasks })
  const job = { id: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'synthetic-private-sentinel', kind: 'moderation-deadline',
    revisionId: null, assessmentId: null, assessmentReceivedAt: null, scheduledAt: new Date('2030-01-01T00:00:00Z'), deliveryGeneration: 0 }
  const signal = new AbortController().signal
  const taskPath = `${queue}/tasks/job-${job.id}-0`
  fixture.controls.failNextTaskDispatches(2)
  for (let i = 0; i < 2; i++) await assert.rejects(dispatcher.dispatch(job, signal), /Cloud Tasks request failed/)
  assert.deepEqual(await fixture.tasks.request('GET', taskPath, null, signal), { status: 404, data: null })
  await dispatcher.dispatch(job, signal)
  await dispatcher.dispatch(job, signal)
  await assert.rejects(dispatcher.dispatch({ ...job, scheduledAt: new Date('2031-01-01T00:00:00Z') }, signal), /could not be verified/)
  const observed = fixture.controls.observe()
  assert.deepEqual(observed, { taskPosts: 5, taskGets: 3, taskFailures: 2, taskDuplicates: 2, emailSends: 0, emailFailures: 0 })
  observed.taskPosts = 999
  assert.equal(fixture.controls.observe().taskPosts, 5)
  assert.doesNotMatch(JSON.stringify(fixture.controls.observe()), /sentinel|11111111|synthetic-project/)
  fixture.controls.failNextTaskDispatches(1)
  await assert.rejects(dispatcher.dispatch(job, signal), /Cloud Tasks request failed/)
  await dispatcher.dispatch(job, signal) // The earlier task still verifies after the failure.
  fixture.controls.failNextTaskDispatches(1)
  fixture.controls.failNextTaskDispatches(0)
  await dispatcher.dispatch(job, signal)
})

test('bounded email failures recover with no provider fallback or external request', async () => {
  const fixture = createOfflineProviderFixtures()
  const message = { from: 'sender@example.invalid', to: 'recipient@example.invalid', subject: 'private subject sentinel', text: 'private body sentinel' }
  let liveCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { liveCalls++; throw new Error('unexpected external request') }
  try {
    const email = selectFixtureProvider('offline', {
      offline: () => fixture.email,
      provider: () => { liveCalls++; throw new Error('unexpected provider selection') },
    })
    fixture.controls.failNextEmailSends(2)
    assert.deepEqual(await sendTransactionalEmail(email, message, 'synthetic-key'), { status: 'unknown' })
    assert.deepEqual(await sendTransactionalEmail(email, message, 'synthetic-key'), { status: 'unknown' })
    const sent = await sendTransactionalEmail(email, message, 'synthetic-key')
    assert.equal(sent.status, 'accepted')
    assert.deepEqual(await sendTransactionalEmail(email, message, 'synthetic-key'), sent)
    const taskFixture = createOfflineProviderFixtures()
    const task = { task: { name: 'synthetic-task' } }
    const signal = new AbortController().signal
    taskFixture.controls.failNextTaskDispatches(1)
    assert.equal((await taskFixture.tasks.request('POST', 'synthetic', task, signal)).status, 503)
    assert.equal((await taskFixture.tasks.request('POST', 'synthetic', task, signal)).status, 200)
    assert.equal(liveCalls, 0)
    assert.deepEqual(fixture.controls.observe(), { taskPosts: 0, taskGets: 0, taskFailures: 0, taskDuplicates: 0, emailSends: 4, emailFailures: 2 })
    assert.doesNotMatch(JSON.stringify(fixture.controls.observe()), /sentinel|example\.invalid|synthetic-key/)
    fixture.controls.failNextEmailSends(1)
    fixture.controls.failNextEmailSends(0)
    assert.equal((await sendTransactionalEmail(email, message, 'synthetic-key')).status, 'accepted')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('controls validate bounds and instances do not share failures, tasks or observations', async () => {
  const first = createOfflineProviderFixtures()
  const second = createOfflineProviderFixtures()
  for (const value of [-1, 101, 1.5, NaN, Infinity, '2', null]) {
    assert.throws(() => first.controls.failNextTaskDispatches(value), RangeError)
    assert.throws(() => first.controls.failNextEmailSends(value), RangeError)
  }
  first.controls.failNextTaskDispatches(1)
  first.controls.failNextEmailSends(1)
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(first.tasks.request('POST', 'synthetic', {}, aborted.signal), { name: 'AbortError' })
  assert.equal(first.controls.observe().taskPosts, 0)
  const signal = new AbortController().signal
  const task = { task: { name: 'synthetic-task' } }
  assert.equal((await second.tasks.request('POST', 'synthetic', task, signal)).status, 200)
  assert.equal((await first.tasks.request('POST', 'synthetic', task, signal)).status, 503)
  assert.equal((await first.tasks.request('POST', 'synthetic', task, signal)).status, 200)
  assert.equal((await second.tasks.request('POST', 'synthetic', task, signal)).status, 409)
  assert.equal((await second.email.emails.send({}, { idempotencyKey: 'synthetic' })).error, null)
  assert.equal((await first.email.emails.send({}, { idempotencyKey: 'synthetic' })).error.statusCode, 503)
  assert.equal(first.controls.observe().taskDuplicates, 0)
  assert.equal(second.controls.observe().taskFailures, 0)
  assert.equal(second.controls.observe().emailFailures, 0)
})
