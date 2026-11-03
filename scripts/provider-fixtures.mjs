import { createHash } from 'node:crypto'

/** Select a supplied adapter deliberately; missing or failing providers never fall back. */
export function selectFixtureProvider(mode, factories) {
  if (mode !== 'offline' && mode !== 'provider') throw new Error('Choose provider mode: offline or provider')
  const factory = factories[mode]
  if (typeof factory !== 'function') throw new Error(`${mode} adapter is not available for this integration`)
  const adapter = factory()
  if (adapter == null) throw new Error(`${mode} adapter is not available for this integration`)
  return adapter
}

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
