/** Reject nonlocal and ambiguous connection strings before constructing a database client. */
export function requireLocalTestDatabase(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('A local disposable test database is required') }
  if (typeof value !== 'string' || value.includes('?') || value.includes('#') ||
      !['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/idea_map_test_[a-z0-9_]+$/.test(url.pathname)) throw new Error('A local disposable test database is required')
  return value
}
