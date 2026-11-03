import pg from 'pg'
import { createGoogleTaskTransport } from '@idea-map/server'
import { recoverMissingTask } from './recover.js'

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 7 || args[0] !== '--queue' || args[2] !== '--job' || args[4] !== '--generation' ||
      args[6] !== '--confirm-reviewed-recovery' || !/^(0|[1-9][0-9]*)$/.test(args[5])) {
    throw new Error('Usage: recover-cli --queue QUEUE --job JOB_UUID --generation GENERATION --confirm-reviewed-recovery')
  }
  if (process.env.WORKER_PROVIDER_MODE !== 'provider') throw new Error('Recovery requires explicit provider mode')
  const configuredQueue = process.env.CLOUD_TASKS_QUEUE
  const databaseUrl = process.env.WORKER_DATABASE_URL
  if (!configuredQueue || configuredQueue !== args[1] || !databaseUrl) throw new Error('Confirm the configured queue and database')
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 })
  try {
    const result = await recoverMissingTask(pool, createGoogleTaskTransport(),
      { queue: args[1], jobId: args[3], generation: Number(args[5]) }, AbortSignal.timeout(5000))
    console.log(JSON.stringify({ jobId: args[3], generation: Number(args[5]), result }))
    if (result !== 'rearmed') process.exitCode = 2
  } finally { await pool.end() }
}

main().catch((error: unknown) => {
  if (error instanceof Error && error.message === 'Recovery requires explicit provider mode') {
    console.error('Recovery requires WORKER_PROVIDER_MODE=provider.')
  } else console.error('Recovery failed; inspect the target and credentials before retrying.')
  process.exitCode = 1
})
