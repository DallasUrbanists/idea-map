import { GoogleAuth } from 'google-auth-library'
import type { DispatchJob, JobDispatcher } from './outbox.js'

export interface TaskTransport {
  request(method: 'POST' | 'GET', path: string, body: unknown, signal: AbortSignal): Promise<{ status: number, data: unknown }>
}

/** Use short-lived Application Default Credentials; callers must scope IAM to the intended queue. */
export function createGoogleTaskTransport(): TaskTransport {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
  return { async request(method, path, body, signal) {
    const token = await auth.getAccessToken()
    if (!token) throw new Error('Cloud Tasks credentials unavailable')
    const response = await fetch(`https://cloudtasks.googleapis.com/v2/${path}`, { method, signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) })
    let data: unknown = null
    try { data = await response.json() } catch { /* A non-JSON error cannot confirm a task. */ }
    return { status: response.status, data }
  } }
}

interface TaskShape {
  name?: string
  scheduleTime?: string
  httpRequest?: { httpMethod?: string, url?: string, body?: string, oidcToken?: { serviceAccountEmail?: string, audience?: string } }
}

// PostgreSQL stores these schedules at millisecond precision. Do not discard a
// provider's extra fractional precision when comparing the returned timestamp.
function matchesSchedule(value: unknown, scheduledAt: Date): boolean {
  if (typeof value !== 'string') return false
  const match = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d{1,9}))?Z$/.exec(value)
  if (!match || /[1-9]/.test((match[1] ?? '').slice(3))) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed === scheduledAt.getTime() && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
}

function taskName(queue: string, jobId: string, generation: number): string {
  if (!/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[a-zA-Z0-9_-]+$/.test(queue) ||
    !/^[0-9a-f-]{36}$/.test(jobId) || !Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid task identity')
  return `${queue}/tasks/job-${jobId}-${generation}`
}

/** Distinguish a provider-confirmed absence from unavailable or unauthorized inspection. */
export async function inspectCloudTask(transport: TaskTransport, queue: string, jobId: string, generation: number, signal: AbortSignal): Promise<'present' | 'absent' | 'unknown'> {
  try {
    const result = await transport.request('GET', taskName(queue, jobId, generation), null, signal)
    return result.status === 200 ? 'present' : result.status === 404 ? 'absent' : 'unknown'
  } catch { return 'unknown' }
}

/** Create a stable task; an existing name is accepted only after the live task is verified. */
export function createCloudTasksDispatcher(options: { queue: string, workerOrigin: string, invokerEmail: string, transport: TaskTransport }): JobDispatcher {
  if (!/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[a-zA-Z0-9_-]+$/.test(options.queue)) throw new Error('Invalid task queue')
  const origin = new URL(options.workerOrigin)
  if (origin.protocol !== 'https:' || origin.origin !== options.workerOrigin || !options.invokerEmail.endsWith('.gserviceaccount.com')) throw new Error('Invalid worker target')
  return { async dispatch(job: DispatchJob, signal: AbortSignal) {
    const name = taskName(options.queue, job.id, job.deliveryGeneration)
    const request = { httpMethod: 'POST', url: `${options.workerOrigin}/tasks/execute`,
      headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify({ jobId: job.id })).toString('base64'),
      oidcToken: { serviceAccountEmail: options.invokerEmail, audience: options.workerOrigin } }
    const created = await options.transport.request('POST', `${options.queue}/tasks`,
      { task: { name, scheduleTime: job.scheduledAt.toISOString(), httpRequest: request } }, signal)
    if (created.status >= 200 && created.status < 300) return
    if (created.status !== 409) throw new Error('Cloud Tasks request failed')
    const found = await options.transport.request('GET', `${name}?responseView=FULL`, null, signal)
    const task = found.data as TaskShape | null
    const http = task?.httpRequest
    if (found.status !== 200 || task?.name !== name || http?.httpMethod !== request.httpMethod || http.url !== request.url ||
      http.body !== request.body || http.oidcToken?.serviceAccountEmail !== options.invokerEmail ||
      http.oidcToken?.audience !== options.workerOrigin || !matchesSchedule(task.scheduleTime, job.scheduledAt)) {
      throw new Error('Cloud Tasks duplicate could not be verified')
    }
  } }
}
