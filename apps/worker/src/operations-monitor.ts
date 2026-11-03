import type pg from 'pg'
import type { TaskTransport } from '@idea-map/server'
import { assessOperations, operationsEvents } from './operations-assessment.js'
import { readOperationsSnapshot } from './operations-snapshot.js'
import { readQueueSnapshot } from './queue-snapshot.js'

/** Return no completion event if either source fails or the observation is invalid. */
export async function collectOperations(pool: pg.Pool, transport: TaskTransport, queueName: string,
  limits: Parameters<typeof assessOperations>[2]) {
  const [database, queue] = await Promise.all([
    readOperationsSnapshot(pool), readQueueSnapshot(transport, queueName),
  ])
  return operationsEvents(assessOperations(database, queue, limits))
}
