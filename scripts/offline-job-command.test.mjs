import assert from 'node:assert/strict'
import { test } from 'node:test'
import { offlinePnpmCommand } from './offline-job-command.mjs'

test('offline scenarios invoke fixed pnpm commands on Windows and Unix', () => {
  for (const [pkg, task] of [['@idea-map/server', 'db:migrate'], ['@idea-map/server', 'test:moderation-integrated'], ['@idea-map/worker', 'test:integration']]) {
    assert.deepEqual(offlinePnpmCommand('win32', pkg, task), {
      command: 'cmd.exe', args: ['/d', '/s', '/c', `pnpm --filter ${pkg} ${task}`],
    })
    assert.deepEqual(offlinePnpmCommand('linux', pkg, task), { command: 'pnpm', args: ['--filter', pkg, task] })
  }
  assert.throws(() => offlinePnpmCommand('win32', '@idea-map/server', 'db:migrate & unwanted'), /Unsupported/)
})
