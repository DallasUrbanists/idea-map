import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDeliveryEventStore } from '../dist/delivery-event-store.js'
import { readMediaPreview } from '../dist/media-preview.js'

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
    assert.equal((await client.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count, 7)
    const deliveryPool = new pg.Pool({ connectionString: url, max: 2 })
    try {
      const store = createDeliveryEventStore(deliveryPool)
      const event = { eventId: 'synthetic-event', emailId: 'synthetic-mail', type: 'email.delivered', occurredAt: '2026-01-01T00:00:00Z' }
      const results = await Promise.all([store.insert(event), store.insert(event)])
      assert.deepEqual(results.sort(), ['duplicate', 'inserted'])
      const stored = await client.query('SELECT event_id, email_id, event_type FROM email_delivery_events WHERE event_id = $1', [event.eventId])
      assert.deepEqual(stored.rows, [{ event_id: event.eventId, email_id: event.emailId, event_type: event.type }])
    } finally {
      await deliveryPool.end()
    }
    // The webhook needs no read access to recipient or message data.
    const role = `idea_map_test_hook_${randomUUID().replaceAll('-', '')}`
    await client.query('BEGIN')
    try {
      await client.query(`CREATE ROLE ${role} NOLOGIN`)
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`)
      await client.query(`GRANT INSERT (event_id, email_id, event_type, occurred_at), SELECT (event_id) ON email_delivery_events TO ${role}`)
      await client.query(`SET LOCAL ROLE ${role}`)
      const store = createDeliveryEventStore(client)
      const event = { eventId: 'limited-event', emailId: 'synthetic-mail', type: 'email.delivered', occurredAt: '2026-01-01T00:00:00Z' }
      assert.equal(await store.insert(event), 'inserted')
      assert.equal(await store.insert(event), 'duplicate')
      await assert.rejects(client.query('SELECT email_id FROM email_delivery_events'), { code: '42501' })
    } finally {
      await client.query('ROLLBACK')
    }
    assert.equal((await client.query('SELECT publication_state FROM ideas WHERE id=$1', [idea])).rows[0].publication_state, 'private')
    await assert.rejects(client.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id) VALUES ($1,$2,$3)', [idea, user, other]), { code: '23503' })
    await client.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id) VALUES ($1,$2,$3)', [idea, user, contact])
    await assert.rejects(client.query('INSERT INTO ownership_claims(idea_id,user_id,contact_id) VALUES ($1,$2,$3)', [idea, user, contact]), { code: '23505' })
    await assert.rejects(client.query("INSERT INTO guest_submission_counters(browser_id,accepted_count) VALUES ('test',3)"), { code: '23514' })
    const revision = (await client.query("INSERT INTO idea_revisions(idea_id,version,content) VALUES ($1,1,'{}') RETURNING id", [idea])).rows[0].id
    const otherIdea = (await client.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    await assert.rejects(client.query('INSERT INTO approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [otherIdea, revision]), { code: '23503' })
    const previewId = (await client.query("INSERT INTO media_previews(idea_id,revision_id,object_name,generation,content_type,published) VALUES ($1,$2,'preview/synthetic','123','image/png',true) RETURNING id", [idea, revision])).rows[0].id
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])
    let reads = 0
    const storage = { bucket(name) {
      assert.equal(name, 'synthetic-approved')
      return { file(objectName, options) {
        assert.equal(objectName, 'preview/synthetic')
        assert.equal(options.preconditionOpts.ifGenerationMatch, '123')
        return { interceptors: [], async getMetadata() { return [{ generation: '123', size: String(image.length), contentType: 'image/png' }] },
          createReadStream() { reads++; return Readable.from([image]) } }
      } }
    } }
    assert.equal(await readMediaPreview(client, storage, 'synthetic-approved', previewId, 100), null)
    assert.equal(reads, 0)
    await client.query("UPDATE ideas SET publication_state = 'approved' WHERE id = $1", [idea])
    await client.query('INSERT INTO approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [idea, revision])
    assert.equal(await readMediaPreview(client, storage, 'synthetic-approved', previewId, 100), null)
    await client.query("UPDATE idea_revisions SET review_state = 'approved' WHERE id = $1", [revision])
    assert.deepEqual(await readMediaPreview(client, storage, 'synthetic-approved', previewId, 100), { bytes: image, contentType: 'image/png' })
    await assert.rejects(readMediaPreview(client, storage, 'synthetic-approved', previewId, 5), /Invalid preview object/)
    await client.query('UPDATE media_previews SET published = false WHERE id = $1', [previewId])
    assert.equal(await readMediaPreview(client, storage, 'synthetic-approved', previewId, 100), null)
    await client.query('UPDATE media_previews SET published = true WHERE id = $1', [previewId])
    const withdrawal = { bucket() { return { file() { return {
      interceptors: [],
      async getMetadata() { return [{ generation: '123', size: String(image.length), contentType: 'image/png' }] },
      createReadStream() { return Readable.from((async function* () {
        await client.query("UPDATE ideas SET publication_state = 'withdrawn' WHERE id = $1", [idea])
        yield image
      })()) },
    } } } } }
    assert.equal(await readMediaPreview(client, withdrawal, 'synthetic-approved', previewId, 100), null)
    await client.query("UPDATE ideas SET publication_state = 'private' WHERE id = $1", [idea])
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
