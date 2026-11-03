import pg from 'pg'
import { readOperationsSnapshot } from './operations-snapshot.js'

async function main() {
  if (process.argv.length !== 2 || !process.env.OPERATIONS_DATABASE_URL) {
    throw new Error('Invalid configuration')
  }
  const pool = new pg.Pool({ connectionString: process.env.OPERATIONS_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 })
  try {
    console.log(JSON.stringify(await readOperationsSnapshot(pool)))
  } finally {
    await pool.end()
  }
}

main().catch(() => {
  // Driver errors can contain connection details; never write them to logs.
  console.error('Operations snapshot failed; check the target and read-only access.')
  process.exitCode = 1
})
