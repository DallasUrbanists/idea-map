import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'
import { reconcileOutbox } from '../dist/outbox.js'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/idea_map_test_worker') {
  throw new Error('TEST_DATABASE_URL must point to a disposable local idea_map_test_worker database on 127.0.0.1')
}

test('worker role reconciles synthetic outbox jobs without private or unrelated write access', async () => {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(await readFile(new URL('./worker-staging-grants.sql', import.meta.url), 'utf8'))
    const rows = await client.query(`INSERT INTO jobs (idempotency_key, kind, scheduled_at)
      VALUES ('worker-grants-success', 'test', now()), ('worker-grants-failure', 'test', now()) RETURNING id`)
    for (const row of rows.rows) await client.query('INSERT INTO outbox (job_id) VALUES ($1)', [row.id])
    await client.query('SET LOCAL ROLE idea_map_worker_test')
    const dispatched = []
    const dispatcher = { async dispatch(job) {
      dispatched.push(job.id)
      if (job.id === rows.rows[1].id) throw new Error('synthetic failure')
    } }
    assert.deepEqual(await reconcileOutbox({ query: (...args) => client.query(...args) }, dispatcher, 2),
      { attempted: 2, failed: 1 })
    assert.deepEqual(new Set(dispatched), new Set(rows.rows.map(row => row.id)))

    for (const statement of ['SELECT id FROM public.contacts', "UPDATE public.jobs SET state = 'completed'",
      'INSERT INTO public.outbox (job_id) VALUES (gen_random_uuid())', 'UPDATE public.outbox SET delivery_generation = 1']) {
      await client.query('SAVEPOINT denied')
      await assert.rejects(client.query(statement), { code: '42501' })
      await client.query('ROLLBACK TO SAVEPOINT denied')
    }
    await client.query('RESET ROLE')
    const state = await client.query('SELECT job_id, published_at IS NOT NULL AS published, dispatch_attempts FROM outbox WHERE job_id = ANY($1::uuid[])', [rows.rows.map(row => row.id)])
    assert.equal(state.rows.find(row => row.job_id === rows.rows[0].id).published, true)
    assert.equal(state.rows.find(row => row.job_id === rows.rows[1].id).published, false)
    assert.ok(state.rows.every(row => row.dispatch_attempts === 1))
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})

test('grant script refuses to change an existing role', async () => {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE ROLE idea_map_worker_test NOLOGIN')
    const sql = await readFile(new URL('./worker-staging-grants.sql', import.meta.url), 'utf8')
    await assert.rejects(client.query(sql), { message: /Test worker role already exists/ })
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})

test('login script refuses to enable a missing role', async () => {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('BEGIN')
    const sql = await readFile(new URL('./worker-staging-enable-login.sql', import.meta.url), 'utf8')
    await assert.rejects(client.query(sql), { message: /Test worker role does not exist/ })
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})

test('worker role can authenticate only after login is enabled', async () => {
  const admin = new pg.Client({ connectionString: url })
  const runtimeUrl = new URL(url)
  runtimeUrl.username = 'idea_map_worker_test'
  runtimeUrl.password = 'local-only-worker-test'
  let ownsRole = false
  await admin.connect()
  try {
    await admin.query('BEGIN')
    await admin.query(await readFile(new URL('./worker-staging-grants.sql', import.meta.url), 'utf8'))
    await admin.query("ALTER ROLE idea_map_worker_test PASSWORD 'local-only-worker-test'")
    await admin.query('COMMIT')
    ownsRole = true

    const disabled = new pg.Client({ connectionString: runtimeUrl.toString() })
    try { await assert.rejects(disabled.connect(), { code: '28000' }) } finally { await disabled.end() }
    await admin.query(await readFile(new URL('./worker-staging-enable-login.sql', import.meta.url), 'utf8'))
    const incorrectUrl = new URL(runtimeUrl)
    incorrectUrl.password = 'incorrect-local-only-password'
    const incorrect = new pg.Client({ connectionString: incorrectUrl.toString() })
    try { await assert.rejects(incorrect.connect(), { code: '28P01' }) } finally { await incorrect.end() }
    const runtime = new pg.Client({ connectionString: runtimeUrl.toString() })
    try {
      await runtime.connect()
      const identity = await runtime.query('SELECT current_user AS role, current_database() AS database')
      assert.deepEqual(identity.rows[0], { role: 'idea_map_worker_test', database: 'idea_map_test_worker' })
      await assert.rejects(runtime.query('SELECT id FROM public.contacts'), { code: '42501' })
    } finally { await runtime.end() }
  } finally {
    try {
      if (ownsRole) {
        await admin.query('DROP OWNED BY idea_map_worker_test')
        await admin.query('DROP ROLE idea_map_worker_test')
      } else {
        await admin.query('ROLLBACK')
      }
    } finally { await admin.end() }
  }
})
