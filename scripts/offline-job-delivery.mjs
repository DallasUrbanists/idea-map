import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

// This runner creates and removes only its own disposable container and databases.
const name = `idea-map-offline-jobs-${randomUUID()}`
let started = false
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, ...options })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`}`)
  return result.stdout?.trim() ?? ''
}
function cleanup() {
  if (!started) return
  started = false
  const result = spawnSync('docker', ['rm', '-f', '-v', name], { encoding: 'utf8', timeout: 30_000 })
  if (result.status !== 0) {
    console.error(`Could not remove the owned container ${name}; remove it manually after inspection.`)
    process.exitCode = 1
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exitCode = 1 })
try {
  // Never pull images or connect to an existing database; no cloud provider is used.
  console.log(`Creating disposable container ${name}`)
  run('docker', ['run', '-d', '--pull=never', '--name', name, '-e', 'POSTGRES_USER=idea_map',
    '-e', 'POSTGRES_PASSWORD=local-only', '-e', 'POSTGRES_DB=idea_map_test_worker',
    '-p', '127.0.0.1::5432', 'postgis/postgis:17-3.6'])
  started = true
  let ready = false
  for (let attempt = 0; attempt < 30; attempt++) {
    const probe = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'idea_map'], { stdio: 'ignore', timeout: 3000 })
    if (probe.status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!ready) throw new Error('Disposable PostGIS did not become ready')
  const portOutput = run('docker', ['port', name, '5432/tcp'])
  const match = /^127\.0\.0\.1:(\d+)$/.exec(portOutput)
  if (!match) throw new Error('Disposable database did not bind exclusively to loopback')
  run('docker', ['exec', name, 'createdb', '-U', 'idea_map', 'idea_map_test_moderation'])
  for (const [database, filter, task] of [
    ['idea_map_test_worker', '@idea-map/worker', 'test:integration'],
    ['idea_map_test_moderation', '@idea-map/server', 'test:moderation-integrated'],
  ]) {
    const url = `postgres://idea_map:local-only@127.0.0.1:${match[1]}/${database}`
    const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url }
    console.log(`Running ${task} against a disposable local database`)
    run('pnpm', ['--filter', '@idea-map/server', 'db:migrate'], { env, stdio: 'inherit' })
    run('pnpm', ['--filter', filter, task], { env, stdio: 'inherit' })
  }
  console.log('Offline job-delivery scenarios passed; no real tasks or email were sent.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Offline job-delivery scenario failed')
  if (!started) console.error(`If container creation had an uncertain outcome, inspect ${name} before removing it.`)
  process.exitCode = 1
} finally { cleanup() }
