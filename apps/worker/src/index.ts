import { createServer } from 'node:http'
import { OAuth2Client } from 'google-auth-library'
import pg from 'pg'
import { createCloudTasksDispatcher, createGoogleTaskTransport, reconcileOutbox } from '@idea-map/server'
import { createWorkerHandler } from './worker.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const origin = required('WORKER_ORIGIN')
const taskInvoker = required('TASK_INVOKER_EMAIL')
const repairInvoker = required('REPAIR_INVOKER_EMAIL')
if (taskInvoker === repairInvoker) throw new Error('Worker invokers must be distinct')
const pool = new pg.Pool({ connectionString: required('WORKER_DATABASE_URL'), max: 1, connectionTimeoutMillis: 5000 })
const oauth = new OAuth2Client()
const dispatcher = createCloudTasksDispatcher({ queue: required('CLOUD_TASKS_QUEUE'), workerOrigin: origin,
  invokerEmail: taskInvoker, transport: createGoogleTaskTransport() })

const server = createServer(createWorkerHandler({ origin, taskInvoker, repairInvoker,
  async verify(token, audience) {
    const ticket = await oauth.verifyIdToken({ idToken: token, audience })
    const claims = ticket.getPayload()
    return { email: claims?.email, verified: claims?.email_verified === true }
  },
  async repair() {
    const result = await reconcileOutbox(pool, dispatcher, 20, { timeoutMs: 5000 })
    console.info(JSON.stringify({ event: 'outbox_repair', ...result }))
    return result
  },
  // Automatic approval remains unavailable until the assessment and moderation gates are accepted.
  async execute() { return 'unavailable' },
}))
const port = Number(process.env.PORT ?? '8080')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
server.listen(port, '0.0.0.0')
