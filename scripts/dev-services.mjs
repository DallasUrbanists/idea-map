import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const projectPath = process.platform === 'win32' ? root.toLowerCase() : root
const project = `idea-map-${createHash('sha256').update(projectPath).digest('hex').slice(0, 12)}`
const windowsDocker = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
const docker = process.platform === 'win32' && existsSync(windowsDocker) ? windowsDocker : 'docker'
const commands = {
  start: ['up', '-d', '--build', 'db', 'firebase'],
  all: ['--profile', 'tools', 'up', '-d', '--build'],
  status: ['--profile', 'tools', 'ps', '-a'],
  stop: ['--profile', 'tools', 'down'],
}
const command = commands[process.argv[2]]
if (!command) throw new Error('Use start, all, status or stop')
console.log(`Compose project: ${project}`)
const result = spawnSync(docker, ['compose', '--project-name', project, '-f', `${root}compose.yaml`, ...command], { cwd: root, stdio: 'inherit' })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
