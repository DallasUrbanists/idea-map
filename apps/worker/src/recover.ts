import type pg from 'pg'
import { inspectCloudTask, rearmMissingDelivery, type TaskTransport } from '@idea-map/server'

export interface RecoveryRequest {
  jobId: string
  generation: number
  queue: string
}

type Inspection = 'present' | 'absent' | 'unknown'

/** An operator must independently review the target queue, job and prior attempts. */
export async function recoverMissingTask(pool: pg.Pool, transport: TaskTransport, request: RecoveryRequest,
  signal: AbortSignal): Promise<'rearmed' | 'present' | 'unknown' | 'unchanged'> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.jobId) ||
      !Number.isSafeInteger(request.generation) || request.generation < 0 || request.generation >= 2_147_483_647 ||
      !/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/[a-zA-Z0-9_-]+$/.test(request.queue)) {
    throw new Error('Invalid recovery target')
  }
  const observation: { inspection: Inspection } = { inspection: 'unknown' }
  const rearmed = await rearmMissingDelivery(pool, request.jobId, request.generation, async () => {
    if (signal.aborted) return 'unknown'
    // A token acquisition can ignore abort. Fail closed without a late database write.
    observation.inspection = await new Promise<Inspection>(resolve => {
      const abort = () => resolve('unknown')
      signal.addEventListener('abort', abort, { once: true })
      const inspect = async (): Promise<Inspection> => {
        try {
          const queue = await transport.request('GET', request.queue, null, signal)
          if (queue.status !== 200 || !queue.data || typeof queue.data !== 'object' ||
              (queue.data as { name?: unknown }).name !== request.queue || signal.aborted) return 'unknown'
          return await inspectCloudTask(transport, request.queue, request.jobId, request.generation, signal)
        } catch { return 'unknown' }
      }
      void inspect()
        .then(value => { signal.removeEventListener('abort', abort); resolve(signal.aborted ? 'unknown' : value) })
      if (signal.aborted) abort()
    })
    return observation.inspection
  })
  if (rearmed) return 'rearmed'
  if (observation.inspection === 'present' || observation.inspection === 'unknown') return observation.inspection
  return 'unchanged'
}
