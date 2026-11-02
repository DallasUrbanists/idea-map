import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { readPublishedIdea } from '../packages/server/dist/published-ideas.js'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to an empty local disposable idea_map_test_* database')
const url = new URL(databaseUrl)
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash || !/^\/(idea_map_test_[a-z0-9_]+)$/.test(url.pathname)) throw new Error('TEST_DATABASE_URL must point to an empty local disposable idea_map_test_* database')
const ids = ['22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000012']
const sentinel = '22000000-0000-4000-8000-000000000099'
const reference = '22000000-0000-4000-8000-000000000098'
const run = action => spawnSync(process.execPath, ['scripts/local-fixtures.mjs', action], { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' })

test('fixtures are repeatable, private, and refuse incomplete or changed data and unrelated references', async () => {
  const db = new Client({ connectionString: databaseUrl })
  await db.connect()
  let owned = false
  let cascadeTableCreated = false
  let missingRevision
  const restoreRevision = async () => {
    if (!missingRevision) return
    const row = missingRevision
    await db.query('INSERT INTO idea_revisions (id, idea_id, version, content, review_state, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [row.id, row.idea_id, row.version, row.content, row.review_state, row.created_at])
    missingRevision = undefined
  }
  try {
    const existing = await db.query('SELECT (SELECT count(*) FROM contacts) + (SELECT count(*) FROM ideas) + (SELECT count(*) FROM audit_events) AS count')
    assert.equal(Number(existing.rows[0].count), 0, 'Use an empty disposable database')
    await db.query("INSERT INTO contacts (id, normalized_email) VALUES ($1, 'unrelated@example.invalid')", [sentinel])
    owned = true
    assert.equal(run('seed').status, 0)
    const before = await db.query('SELECT id, publication_state, ST_AsText(location::geometry) AS location FROM ideas ORDER BY id')
    assert.equal(run('seed').status, 0)
    assert.deepEqual((await db.query('SELECT id, publication_state, ST_AsText(location::geometry) AS location FROM ideas ORDER BY id')).rows, before.rows)
    assert.deepEqual(await readPublishedIdea(databaseUrl, ids[0]), { title: 'A fictional crossing', description: 'A synthetic public idea.' })
    assert.equal(await readPublishedIdea(databaseUrl, ids[1]), null)
    await db.query("UPDATE ideas SET publication_state = 'withdrawn' WHERE id = $1", [ids[0]])
    assert.notEqual(run('seed').status, 0)
    assert.notEqual(run('clean').status, 0)
    assert.equal((await db.query('SELECT count(*) FROM ideas')).rows[0].count, '2')
    await db.query("UPDATE ideas SET publication_state = 'approved' WHERE id = $1", [ids[0]])
    const privateRevision = (await db.query('SELECT * FROM idea_revisions WHERE idea_id = $1', [ids[1]])).rows[0]
    assert.ok(privateRevision)
    await db.query('DELETE FROM idea_revisions WHERE id = $1', [privateRevision.id])
    missingRevision = privateRevision
    assert.notEqual(run('seed').status, 0)
    assert.notEqual(run('clean').status, 0)
    assert.equal((await db.query('SELECT count(*) FROM ideas')).rows[0].count, '2')
    await restoreRevision()
    await db.query("INSERT INTO audit_events (id, idea_id, event_type) VALUES ($1, $2, 'unrelated')", [reference, ids[0]])
    assert.notEqual(run('clean').status, 0)
    assert.equal((await db.query('SELECT count(*) FROM idea_revisions')).rows[0].count, '2')
    await db.query('DELETE FROM audit_events WHERE id = $1', [reference])
    await db.query('CREATE TABLE fixture_cascade_check (idea_id uuid REFERENCES ideas(id) ON DELETE CASCADE)')
    cascadeTableCreated = true
    await db.query('INSERT INTO fixture_cascade_check (idea_id) VALUES ($1)', [ids[0]])
    assert.notEqual(run('clean').status, 0)
    assert.equal((await db.query('SELECT count(*) FROM fixture_cascade_check')).rows[0].count, '1')
    await db.query('DROP TABLE fixture_cascade_check')
    cascadeTableCreated = false
    assert.equal(run('clean').status, 0)
    assert.equal(run('clean').status, 0)
    assert.equal((await db.query('SELECT count(*) FROM contacts WHERE id = $1', [sentinel])).rows[0].count, '1')
  } finally {
    let cleanup
    try {
      if (cascadeTableCreated) await db.query('DROP TABLE fixture_cascade_check')
      if (owned) {
        await restoreRevision()
        await db.query('DELETE FROM audit_events WHERE id = $1', [reference])
        await db.query("UPDATE ideas SET publication_state = 'approved' WHERE id = $1", [ids[0]])
        cleanup = run('clean')
        await db.query('DELETE FROM contacts WHERE id = $1', [sentinel])
      }
    } finally { await db.end() }
    if (cleanup) assert.equal(cleanup.status, 0, cleanup.stderr)
  }
})
