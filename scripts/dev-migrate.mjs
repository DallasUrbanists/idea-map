import { spawnSync } from 'node:child_process'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
const result = spawnSync(process.execPath, ['--run', 'db:migrate'], {
  cwd: fileURLToPath(new URL('../packages/server/', import.meta.url)),
  stdio: 'inherit',
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
