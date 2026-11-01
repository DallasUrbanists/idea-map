import { spawn } from 'node:child_process'

const children = [
  spawn('pnpm', ['--filter', '@idea-map/web', 'dev', '--host', '0.0.0.0'], { stdio: 'inherit' }),
  spawn('pnpm', ['--filter', '@idea-map/web', 'storybook', '--host', '0.0.0.0', '--no-open'], { stdio: 'inherit' }),
]
let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  process.exitCode = code
}
for (const child of children) {
  child.once('error', error => { console.error(error); stop(1) })
  child.once('exit', code => stop(code ?? 1))
}
process.once('SIGTERM', () => stop(0))
process.once('SIGINT', () => stop(0))
