import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCloudTasksDispatcher, inspectCloudTask } from '../dist/cloud-tasks.js'

test('task creation preserves identity and never accepts an unverified duplicate', async () => {
  const queue = 'projects/synthetic-project/locations/us-central1/queues/jobs'
  const origin = 'https://worker.example.invalid'
  const invokerEmail = 'tasks@synthetic-project.iam.gserviceaccount.com'
  const job = { id: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'synthetic', kind: 'moderation-deadline',
    revisionId: null, assessmentId: null, assessmentReceivedAt: null, scheduledAt: new Date('2030-01-01T00:00:00Z'), deliveryGeneration: 0 }
  let captured
  const dispatcher = createCloudTasksDispatcher({ queue, workerOrigin: origin, invokerEmail,
    transport: { async request(method, path, body) { assert.equal(method, 'POST'); assert.equal(path, `${queue}/tasks`); captured = body.task; return { status: 200 } } } })
  await dispatcher.dispatch(job, new AbortController().signal)
  assert.equal(captured.name, `${queue}/tasks/job-${job.id}-0`)
  assert.equal(captured.scheduleTime, job.scheduledAt.toISOString())
  assert.equal(captured.httpRequest.oidcToken.audience, origin)
  assert.deepEqual(JSON.parse(Buffer.from(captured.httpRequest.body, 'base64').toString()), { jobId: job.id })
  let observedPath
  const duplicate = (task, status = 200) => createCloudTasksDispatcher({ queue, workerOrigin: origin, invokerEmail,
    transport: { async request(method, path) { if (method === 'POST') return { status: 409 }; observedPath = path; return { status, data: task } } } })
  await duplicate(captured).dispatch(job, new AbortController().signal)
  assert.match(observedPath, /responseView=FULL$/)
  await assert.rejects(duplicate(null, 404).dispatch(job, new AbortController().signal), /could not be verified/)
  await assert.rejects(duplicate({ ...captured, httpRequest: { ...captured.httpRequest, url: `${origin}/wrong` } }).dispatch(job, new AbortController().signal), /could not be verified/)
  await assert.rejects(duplicate({ ...captured, scheduleTime: '2029-12-31T23:59:59Z' }).dispatch(job, new AbortController().signal), /could not be verified/)
  const inspector = status => ({ async request() { return { status } } })
  assert.equal(await inspectCloudTask(inspector(404), queue, job.id, 0, new AbortController().signal), 'absent')
  assert.equal(await inspectCloudTask(inspector(200), queue, job.id, 0, new AbortController().signal), 'present')
  assert.equal(await inspectCloudTask(inspector(403), queue, job.id, 0, new AbortController().signal), 'unknown')
  await dispatcher.dispatch({ ...job, deliveryGeneration: 1 }, new AbortController().signal)
  assert.match(captured.name, /-1$/)
})
