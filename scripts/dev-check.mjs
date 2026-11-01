import { createRequire } from 'node:module'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')
const db = new Client({ connectionString: 'postgres://idea_map:local-only@127.0.0.1:54329/idea_map_dev', connectionTimeoutMillis: 3000 })
async function database() {
  try {
    await db.connect()
    const result = await db.query('select postgis_version() as version')
    console.log(`PostGIS: ${result.rows[0].version}`)
  } finally { await db.end() }
}
async function endpoint(name, url) {
  let response
  try { response = await fetch(url, { signal: AbortSignal.timeout(5000) }) }
  catch (error) { throw new Error(`${name}: ${error.cause?.message ?? error.message}`) }
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  console.log(`${name}: HTTP ${response.status}`)
}
try {
  await Promise.all([
    database(),
    endpoint('Firebase Auth emulator', 'http://127.0.0.1:9099/emulator/v1/projects/demo-idea-map/config'),
    endpoint('Firestore emulator', 'http://127.0.0.1:8080/'),
  ])
} catch (error) {
  console.error('Service readiness check failed:', error.message)
  process.exitCode = 1
}
