import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) {
  throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')
}

test('bootstrap, forward migrations, ownership constraints and PostGIS', async () => {
  const client = new pg.Client({ connectionString: url })
  const initial = await mkdtemp(join(tmpdir(), 'idea-map-migrations-'))
  const migrations = resolve('migrations')
  try {
    await cp(join(migrations, 'meta'), join(initial, 'meta'), { recursive: true })
    await cp(join(migrations, '0000_initial.sql'), join(initial, '0000_initial.sql'))
    const journalPath = join(initial, 'meta', '_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.entries = journal.entries.slice(0, 1)
    await writeFile(journalPath, JSON.stringify(journal))
    await client.connect()
    const db = drizzle(client)
    await migrate(db, { migrationsFolder: initial })
    const contact = (await client.query("INSERT INTO contacts(normalized_email) VALUES ('test@example.invalid') RETURNING id")).rows[0].id
    const other = (await client.query("INSERT INTO contacts(normalized_email) VALUES ('other@example.invalid') RETURNING id")).rows[0].id
    const user = (await client.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    const idea = (await client.query("INSERT INTO ideas(author_contact_id, location) VALUES ($1, ST_SetSRID(ST_MakePoint(-96.8,32.8),4326)::geography) RETURNING id", [contact])).rows[0].id
    await migrate(db, { migrationsFolder: migrations })
    await migrate(db, { migrationsFolder: migrations })
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count, 3)
    assert.equal((await client.query('SELECT publication_state FROM ideas WHERE id=$1', [idea])).rows[0].publication_state, 'private')
    await assert.rejects(client.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id) VALUES ($1,$2,$3)', [idea, user, other]), { code: '23503' })
    await client.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id) VALUES ($1,$2,$3)', [idea, user, contact])
    await assert.rejects(client.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id) VALUES ($1,$2,$3)', [idea, user, contact]), { code: '23505' })
    await assert.rejects(client.query("INSERT INTO guest_submission_counters(browser_id,accepted_count) VALUES ('test',3)"), { code: '23514' })
    const revision = (await client.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
    const otherIdea = (await client.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    await assert.rejects(client.query('INSERT INTO approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [otherIdea, revision]), { code: '23503' })
    const nearby = await client.query('SELECT id FROM ideas WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-96.8,32.8),4326)::geography, 100)')
    assert.equal(nearby.rows[0].id, idea)
    await client.query('SET enable_seqscan = off')
    const plan = await client.query('EXPLAIN SELECT id FROM ideas WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-96.8,32.8),4326)::geography, 100)')
    assert.match(plan.rows.map(row => row['QUERY PLAN']).join('\n'), /ideas_location_gist_idx/)
    const indexes = await client.query("SELECT indexname FROM pg_indexes WHERE tablename IN ('ideas','identities','ownership_claims')")
    for (const name of ['ideas_owner_idx', 'ideas_author_contact_idx', 'identities_provider_subject_key', 'ownership_claims_idea_key', 'ownership_claims_user_idx']) {
      assert.ok(indexes.rows.some(row => row.indexname === name), name)
    }
  } finally {
    await client.end()
    await rm(initial, { recursive: true, force: true })
  }
})
