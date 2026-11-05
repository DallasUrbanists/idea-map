import { createHash } from 'node:crypto'

export { selectProvider as selectFixtureProvider } from '../packages/server/dist/provider-mode.js'

function failureCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new RangeError('Failure count must be an integer from 0 to 100')
  return value
}

/** In-memory adapters for the existing Streetmix, Resend and Cloud Tasks boundaries. */
export function createOfflineProviderFixtures() {
  const tasks = new Map()
  let taskFailuresRemaining = 0
  let emailFailuresRemaining = 0
  const attempts = { taskPosts: 0, taskGets: 0, taskFailures: 0, taskDuplicates: 0, emailSends: 0, emailFailures: 0 }
  return {
    controls: {
      failNextTaskDispatches(count) { taskFailuresRemaining = failureCount(count) },
      failNextEmailSends(count) { emailFailuresRemaining = failureCount(count) },
      observe() { return { ...attempts } },
    },
    design: {
      async create(plan, { sourceRevision }) {
        const digest = createHash('sha256').update(JSON.stringify(plan)).update('\0').update(sourceRevision).digest('hex').slice(0, 16)
        return { provider: 'offline-fixture', designId: `fixture-${digest}`, sourceRevision }
      },
    },
    email: { emails: { async send(_message, { idempotencyKey }) {
      attempts.emailSends++
      if (emailFailuresRemaining > 0) {
        emailFailuresRemaining--
        attempts.emailFailures++
        return { data: null, error: { statusCode: 503 } }
      }
      const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)
      return { data: { id: `fixture-${digest}` }, error: null }
    } } },
    tasks: { async request(method, path, body, signal) {
      signal.throwIfAborted()
      if (method === 'POST') {
        attempts.taskPosts++
        if (taskFailuresRemaining > 0) {
          taskFailuresRemaining--
          attempts.taskFailures++
          return { status: 503, data: null }
        }
        const task = body?.task
        if (!task?.name) return { status: 400, data: null }
        if (tasks.has(task.name)) {
          attempts.taskDuplicates++
          return { status: 409, data: null }
        }
        // Clone so callers cannot change a previously submitted task by mutation.
        tasks.set(task.name, structuredClone(task))
        return { status: 200, data: null }
      }
      attempts.taskGets++
      const task = tasks.get(path.replace(/\?responseView=FULL$/, ''))
      return { status: task ? 200 : 404, data: task ? structuredClone(task) : null }
    } },
  }
}
