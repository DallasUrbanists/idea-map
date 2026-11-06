import { createGoogleTaskTransport } from '@idea-map/server'
import { readQueueSnapshot } from './queue-snapshot.js'

async function main() {
  if (process.argv.length !== 2 || !process.env.OPERATIONS_TASK_QUEUE) throw new Error('Invalid configuration')
  console.log(JSON.stringify(await readQueueSnapshot(createGoogleTaskTransport(), process.env.OPERATIONS_TASK_QUEUE)))
}

main().catch(() => {
  console.error('Queue snapshot failed; check the target and read-only access.')
  process.exitCode = 1
})
