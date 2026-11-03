import { createHash } from 'node:crypto'

export { selectProvider as selectFixtureProvider } from '../packages/server/dist/provider-mode.js'

/** In-memory adapters for the existing Streetmix, Resend and Cloud Tasks boundaries. */
export function createOfflineProviderFixtures() {
  const tasks = new Map()
  return {
    design: {
      async create(plan, { sourceRevision }) {
        const digest = createHash('sha256').update(JSON.stringify(plan)).update('\0').update(sourceRevision).digest('hex').slice(0, 16)
        return { provider: 'offline-fixture', designId: `fixture-${digest}`, sourceRevision }
      },
    },
    email: { emails: { async send(_message, { idempotencyKey }) {
      const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)
      return { data: { id: `fixture-${digest}` }, error: null }
    } } },
    tasks: { async request(method, path, body, signal) {
      signal.throwIfAborted()
      if (method === 'POST') {
        const task = body?.task
        if (!task?.name || tasks.has(task.name)) return { status: task?.name ? 409 : 400, data: null }
        // Clone so callers cannot change a previously submitted task by mutation.
        tasks.set(task.name, structuredClone(task))
        return { status: 200, data: null }
      }
      const task = tasks.get(path.replace(/\?responseView=FULL$/, ''))
      return { status: task ? 200 : 404, data: task ? structuredClone(task) : null }
    } },
  }
}
