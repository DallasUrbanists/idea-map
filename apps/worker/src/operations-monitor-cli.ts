import pg from 'pg'
import { createGoogleTaskTransport } from '@idea-map/server'
import { collectOperations } from './operations-monitor.js'

function threshold(name: string): number {
  const raw = process.env[name]
  if (!raw || !/^[1-9][0-9]{0,8}$/.test(raw)) throw new Error('Invalid operations threshold')
  return Number(raw)
}

function databaseThreshold(): string {
  const raw = process.env.OPERATIONS_DATABASE_CAPACITY_BYTES
  if (!raw || !/^[1-9][0-9]{0,18}$/.test(raw) || BigInt(raw) > 9_223_372_036_854_775_807n) {
    throw new Error('Invalid operations threshold')
  }
  return raw
}

async function main() {
  if (process.argv.length !== 2 || !process.env.OPERATIONS_DATABASE_URL || !process.env.OPERATIONS_TASK_QUEUE) {
    throw new Error('Invalid operations configuration')
  }
  const limits = { backlogSeconds: threshold('OPERATIONS_OUTBOX_AGE_SECONDS'), overdueSeconds: threshold('OPERATIONS_OVERDUE_AGE_SECONDS'),
    queueSeconds: threshold('OPERATIONS_QUEUE_AGE_SECONDS'), emailEvents: threshold('OPERATIONS_EMAIL_EVENTS'),
    databaseBytes: databaseThreshold() }
  const pool = new pg.Pool({ connectionString: process.env.OPERATIONS_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 })
  let events: Awaited<ReturnType<typeof collectOperations>>
  try {
    events = await collectOperations(pool, createGoogleTaskTransport(), process.env.OPERATIONS_TASK_QUEUE, limits)
  } finally {
    await pool.end()
  }
  for (const event of events) console.log(JSON.stringify(event))
}

main().catch(() => {
  // Driver and provider errors can contain credentials or identifiers.
  console.error(JSON.stringify({ severity: 'ERROR', event: 'operations_collection_failed' }))
  process.exitCode = 1
})
