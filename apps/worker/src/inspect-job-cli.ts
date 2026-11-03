import pg from 'pg'
import { inspectJob } from './inspect-job.js'

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--job' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[1])) {
    throw new Error('Invalid arguments')
  }
  const mode = process.env.WORKER_PROVIDER_MODE
  const databaseUrl = process.env.WORKER_DATABASE_URL
  if (!databaseUrl || !['offline', 'provider'].includes(mode ?? '')) throw new Error('Invalid configuration')
  if (mode === 'offline') {
    const url = new URL(databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.search || url.hash || !/^\/(idea_map_dev|idea_map_test_[a-z0-9_]+)$/.test(url.pathname)) throw new Error('Invalid offline database')
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 })
  try {
    const snapshot = await inspectJob(pool, args[1])
    if (!snapshot) { console.error('Job not found.'); process.exitCode = 2; return }
    console.log(JSON.stringify({ snapshot, notice: 'Database state only; provider presence and retry safety are not established.' }))
  } finally { await pool.end() }
}

main().catch(() => { console.error('Inspection failed; check the job ID, mode, database and read-only access.') ; process.exitCode = 1 })
