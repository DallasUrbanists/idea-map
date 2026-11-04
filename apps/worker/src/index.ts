import { createServer } from 'node:http'
import { OAuth2Client } from 'google-auth-library'
import pg from 'pg'
import { createCloudTasksDispatcher, createGoogleTaskTransport, reconcileOutbox, selectProvider, type JobDispatcher } from '@idea-map/server'
import { createWorkerHandler, type WorkerDependencies } from './worker.js'
import { createJobExecutor } from './job-router.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const mode = required('WORKER_PROVIDER_MODE')
const origin = required('WORKER_ORIGIN')
const taskInvoker = required('TASK_INVOKER_EMAIL')
const repairInvoker = required('REPAIR_INVOKER_EMAIL')
if (taskInvoker === repairInvoker) throw new Error('Worker invokers must be distinct')
const databaseUrl = required('WORKER_DATABASE_URL')
const dependencies = selectProvider<{ verify: WorkerDependencies['verify'], dispatcher: JobDispatcher }>(mode, {
  offline: () => {
    const url = new URL(databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.search || url.hash || !/^\/(idea_map_dev|idea_map_test_[a-z0-9_]+)$/.test(url.pathname)) {
      throw new Error('Offline worker requires a local development or disposable test database')
    }
    return {
      async verify(): Promise<{ email?: string, verified: boolean }> { throw new Error('Offline worker authentication is unavailable') },
      dispatcher: { async dispatch(): Promise<void> { throw new Error('Offline task delivery is unavailable') } },
    }
  },
  provider: () => {
    const oauth = new OAuth2Client()
    return {
      async verify(token: string, audience: string) {
        const ticket = await oauth.verifyIdToken({ idToken: token, audience })
        const claims = ticket.getPayload()
        return { email: claims?.email, verified: claims?.email_verified === true }
      },
      dispatcher: createCloudTasksDispatcher({ queue: required('CLOUD_TASKS_QUEUE'), workerOrigin: origin,
        invokerEmail: taskInvoker, transport: createGoogleTaskTransport() }),
    }
  },
})
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 })

const server = createServer(createWorkerHandler({ origin, taskInvoker, repairInvoker,
  verify: dependencies.verify,
  async repair() {
    const result = await reconcileOutbox(pool, dependencies.dispatcher, 20, { timeoutMs: 5000 })
    console.info(JSON.stringify({ event: 'outbox_repair', ...result }))
    return result
  },
  // Automatic approval remains unavailable until the assessment and moderation gates are accepted.
  execute: createJobExecutor(pool),
}))
const port = Number(process.env.PORT ?? '8080')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
server.listen(port, mode === 'offline' ? '127.0.0.1' : '0.0.0.0')

// Cloud Run and Docker send SIGTERM to stop accepting work before termination.
// Bound the drain so stalled requests cannot keep the instance alive forever.
let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => process.exit(1), 8_000)
  server.close(async error => {
    try {
      if (error) throw error
      await pool.end()
      clearTimeout(deadline)
    } catch {
      clearTimeout(deadline)
      process.exitCode = 1
    }
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
