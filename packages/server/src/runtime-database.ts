import pg from 'pg'

const pools = new Map<string, pg.Pool>()

/** Share the web process's bounded pool for each configured database URL. */
export function runtimeDatabasePool(databaseUrl: string): pg.Pool {
  let pool = pools.get(databaseUrl)
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 })
    pool.on('error', () => console.error('Unexpected error on idle PostgreSQL client'))
    pools.set(databaseUrl, pool)
  }
  return pool
}
