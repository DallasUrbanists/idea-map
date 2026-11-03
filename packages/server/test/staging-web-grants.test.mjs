import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'
import { readPublishedIdea } from '../dist/published-ideas.js'
import { runtimeDatabasePool } from '../dist/runtime-database.js'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/idea_map_test_worker') {
  throw new Error('TEST_DATABASE_URL must point to a disposable local idea_map_test_worker database on 127.0.0.1')
}

test('the staging web role reads only the public application result and cannot use worker or private tables', async () => {
  const admin = new pg.Client({ connectionString: url })
  const runtimeUrl = new URL(url)
  runtimeUrl.username = 'idea_map_staging_web_test'
  runtimeUrl.password = 'local-only-staging-web-test'
  let ownsFixtures = false
  let usedPool = false
  await admin.connect()
  try {
    await admin.query('BEGIN')
    await admin.query(await readFile(new URL('./staging-web-grants.sql', import.meta.url), 'utf8'))
    await admin.query(await readFile(new URL('./ssr-fixture.sql', import.meta.url), 'utf8'))
    await admin.query("ALTER ROLE idea_map_staging_web_test PASSWORD 'local-only-staging-web-test'")
    await admin.query('COMMIT')
    ownsFixtures = true

    const disabled = new pg.Client({ connectionString: runtimeUrl.toString() })
    try { await assert.rejects(disabled.connect(), { code: '28000' }) } finally { await disabled.end() }
    await admin.query(await readFile(new URL('./staging-web-enable-login.sql', import.meta.url), 'utf8'))
    usedPool = true
    assert.deepEqual(await readPublishedIdea(runtimeUrl.toString(), '11111111-1111-4111-8111-111111111111'),
      { title: 'A safer crossing', description: 'A synthetic public idea.' })
    assert.equal(await readPublishedIdea(runtimeUrl.toString(), '22222222-2222-4222-8222-222222222222'), null)
    assert.equal(await readPublishedIdea(runtimeUrl.toString(), '33333333-3333-4333-8333-333333333333'), null)

    const runtime = new pg.Client({ connectionString: runtimeUrl.toString() })
    try {
      await runtime.connect()
      for (const statement of ['SELECT id FROM public.contacts', 'SELECT id FROM public.jobs', 'UPDATE public.outbox SET published_at = now()']) {
        await assert.rejects(runtime.query(statement), { code: '42501' })
      }
    } finally { await runtime.end() }
  } finally {
    try {
      if (usedPool) await runtimeDatabasePool(runtimeUrl.toString()).end()
      if (ownsFixtures) {
        await admin.query('BEGIN')
        await admin.query("DELETE FROM approved_revisions WHERE idea_id IN ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')")
        await admin.query("DELETE FROM idea_revisions WHERE id IN ('aaaaaaaa-1111-4111-8111-111111111111', 'aaaaaaaa-2222-4222-8222-222222222222', 'aaaaaaaa-3333-4333-8333-333333333333')")
        await admin.query("DELETE FROM ideas WHERE id IN ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')")
        await admin.query("DELETE FROM contacts WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")
        await admin.query('DROP OWNED BY idea_map_staging_web_test')
        await admin.query('DROP ROLE idea_map_staging_web_test')
        await admin.query('COMMIT')
      } else {
        await admin.query('ROLLBACK')
      }
    } finally { await admin.end() }
  }
})

test('the web grant script refuses to change an existing role', async () => {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  try {
    await admin.query('BEGIN')
    await admin.query('CREATE ROLE idea_map_staging_web_test NOLOGIN')
    await assert.rejects(admin.query(await readFile(new URL('./staging-web-grants.sql', import.meta.url), 'utf8')),
      { message: /Test web role already exists/ })
  } finally {
    await admin.query('ROLLBACK')
    await admin.end()
  }
})

test('the web login script refuses to enable a missing role', async () => {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  try {
    await admin.query('BEGIN')
    await assert.rejects(admin.query(await readFile(new URL('./staging-web-enable-login.sql', import.meta.url), 'utf8')),
      { message: /Test web role does not exist/ })
  } finally {
    await admin.query('ROLLBACK')
    await admin.end()
  }
})
