import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { cleanLocalJobFixture, seedLocalJobFixture, validateFixtureUrl } from './local-job-fixture.mjs'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')
const url = validateFixtureUrl(process.env.TEST_DATABASE_URL)
if (!new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('A disposable test database is required')
const fixtureContact = 'a16b6e1b-95d5-42bd-b970-f6626538e001'

test('fixture is deterministic and cleanup preserves unrelated or conflicting records', async () => {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const other = (await client.query("INSERT INTO contacts(normalized_email) VALUES ('unrelated@example.invalid') RETURNING id")).rows[0].id
    assert.equal(await seedLocalJobFixture(client), 'seeded')
    const before = (await client.query("SELECT j.id,j.state,j.scheduled_at,o.published_at FROM jobs j JOIN outbox o ON o.job_id=j.id WHERE j.kind='synthetic-fixture'")).rows
    assert.equal(before.length, 1)
    assert.equal(before[0].state, 'stale')
    assert.ok(before[0].published_at)
    assert.equal(await seedLocalJobFixture(client), 'already-seeded')
    assert.deepEqual((await client.query("SELECT j.id,j.state,j.scheduled_at,o.published_at FROM jobs j JOIN outbox o ON o.job_id=j.id WHERE j.kind='synthetic-fixture'")).rows, before)
    await client.query("UPDATE revision_assessments SET fingerprint=repeat('b',64) WHERE id='synthetic-local-job-fixture-v1'")
    await assert.rejects(cleanLocalJobFixture(client), /changed or are incomplete/)
    await client.query("UPDATE revision_assessments SET fingerprint=repeat('a',64) WHERE id='synthetic-local-job-fixture-v1'")
    const external = (await client.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [fixtureContact])).rows[0].id
    await assert.rejects(cleanLocalJobFixture(client), { code: '23503' })
    assert.equal((await client.query("SELECT count(*)::int AS n FROM jobs WHERE kind='synthetic-fixture'")).rows[0].n, 1)
    await client.query('DELETE FROM ideas WHERE id=$1', [external])
    assert.equal(await cleanLocalJobFixture(client), 'cleaned')
    assert.equal(await cleanLocalJobFixture(client), 'absent')
    assert.equal((await client.query('SELECT normalized_email FROM contacts WHERE id=$1', [other])).rows[0].normalized_email, 'unrelated@example.invalid')
    await client.query("INSERT INTO contacts(id,normalized_email) VALUES ($1,'collision@example.invalid')", [fixtureContact])
    await assert.rejects(seedLocalJobFixture(client), { code: '23505' })
    assert.equal(await cleanLocalJobFixture(client), 'absent')
    assert.equal((await client.query('SELECT normalized_email FROM contacts WHERE id=$1', [fixtureContact])).rows[0].normalized_email, 'collision@example.invalid')
  } finally { await client.end() }
})
