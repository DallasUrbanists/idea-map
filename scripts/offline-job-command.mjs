// These fixed commands avoid interpolating paths, environment values or user input into cmd.exe.
const allowed = new Set([
  '@idea-map/server db:migrate',
  '@idea-map/server test:moderation-integrated',
  '@idea-map/worker test:integration',
])

export function offlinePnpmCommand(platform, filter, task) {
  const selection = `${filter} ${task}`
  if (!allowed.has(selection)) throw new Error('Unsupported offline scenario command')
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/s', '/c', `pnpm --filter ${selection}`] }
  return { command: 'pnpm', args: ['--filter', filter, task] }
}
