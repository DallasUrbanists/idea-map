import type { IncomingMessage, ServerResponse } from 'node:http'

export interface WorkerDependencies {
  origin: string
  taskInvoker: string
  repairInvoker: string
  verify(token: string, audience: string): Promise<{ email?: string, verified: boolean }>
  execute(jobId: string): Promise<'completed' | 'stale' | 'duplicate' | 'not-due' | 'missing' | 'unavailable'>
  repair(): Promise<{ attempted: number, failed: number }>
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 2048) throw new Error('Request too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Authenticate each private operation independently of Cloud Run ingress. */
export function createWorkerHandler(deps: WorkerDependencies) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Cache-Control', 'private, no-store')
    const send = (status: number) => { response.statusCode = status; response.end() }
    try {
      if (request.method === 'GET' && request.url === '/healthz') return send(200)
      if (request.method !== 'POST' || !['/tasks/execute', '/tasks/repair'].includes(request.url ?? '')) return send(404)
      const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '')
      if (!match) return send(401)
      let identity: { email?: string, verified: boolean }
      try { identity = await deps.verify(match[1], deps.origin) } catch { return send(401) }
      const allowed = request.url === '/tasks/execute' ? deps.taskInvoker : deps.repairInvoker
      if (!identity.verified || identity.email !== allowed) return send(403)
      if (request.url === '/tasks/repair') {
        const result = await deps.repair()
        return send(result.failed ? 503 : 204)
      }
      if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return send(415)
      let body: unknown
      try { body = await readBody(request) } catch { return send(400) }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        typeof (body as { jobId?: unknown }).jobId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((body as { jobId: string }).jobId)) return send(400)
      const result = await deps.execute((body as { jobId: string }).jobId)
      return send(['completed', 'stale', 'duplicate'].includes(result) ? 204 : 503)
    } catch { return send(503) }
  }
}
