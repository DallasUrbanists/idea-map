import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')
const contactId = '22000000-0000-4000-8000-000000000001'
const ideas = [
  { id: '22000000-0000-4000-8000-000000000011', revision: '22000000-0000-4000-8000-000000000021', state: 'approved', review: 'approved', lon: 0, lat: 0, content: { title: 'A fictional crossing', description: 'A synthetic public idea.' } },
  { id: '22000000-0000-4000-8000-000000000012', revision: '22000000-0000-4000-8000-000000000022', state: 'private', review: 'waiting', lon: 0.01, lat: 0.01, content: { title: 'A private fictional idea', description: 'A synthetic private idea.' } },
]
const ids = ideas.map(idea => idea.id)
const revisions = ideas.map(idea => idea.revision)
const created = '2020-01-01T00:00:00.000Z'

function localUrl(value) {
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash || !/^\/(idea_map_dev|idea_map_test_[a-z0-9_]+)$/.test(url.pathname)) {
    throw new Error('Fixtures require a local idea_map_dev or idea_map_test_* PostgreSQL database without URL options')
  }
  return value
}

async function rows(client) {
  const contacts = await client.query('SELECT * FROM contacts WHERE id = $1', [contactId])
  const foundIdeas = await client.query('SELECT *, ST_X(location::geometry) AS longitude, ST_Y(location::geometry) AS latitude FROM ideas WHERE id = ANY($1::uuid[]) ORDER BY id', [ids])
  const foundRevisions = await client.query('SELECT * FROM idea_revisions WHERE id = ANY($1::uuid[]) ORDER BY id', [revisions])
  const approved = await client.query('SELECT * FROM approved_revisions WHERE idea_id = ANY($1::uuid[]) ORDER BY idea_id', [ids])
  return { contacts: contacts.rows, ideas: foundIdeas.rows, revisions: foundRevisions.rows, approved: approved.rows }
}
function check(snapshot) {
  assert.equal(snapshot.contacts.length, 1, 'Fixture contact missing or changed')
  assert.deepEqual(snapshot.contacts[0], { id: contactId, normalized_email: 'fixtures@example.invalid', verified_at: null, created_at: new Date(created) }, 'Fixture contact changed')
  assert.equal(snapshot.ideas.length, ideas.length, 'Fixture ideas missing or changed')
  assert.equal(snapshot.revisions.length, ideas.length, 'Fixture revisions missing or changed')
  assert.deepEqual(snapshot.approved, [{ idea_id: ideas[0].id, revision_id: ideas[0].revision }], 'Fixture approval changed')
  for (let i = 0; i < ideas.length; i++) {
    const expected = ideas[i]
    const { location, ...actual } = snapshot.ideas[i]
    assert.ok(location, 'Fixture location missing')
    assert.deepEqual(actual, { id: expected.id, owner_id: null, author_contact_id: contactId, publication_state: expected.state, created_at: new Date(created), longitude: expected.lon, latitude: expected.lat }, 'Fixture idea changed')
    assert.deepEqual(snapshot.revisions[i], { id: expected.revision, idea_id: expected.id, version: 1, content: expected.content, review_state: expected.review, created_at: new Date(created) }, 'Fixture revision changed')
  }
}
async function main() {
  const action = process.argv[2]
  if (!['seed', 'clean'].includes(action)) throw new Error('Use seed or clean')
  if (!process.env.DATABASE_URL) loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))
  const client = new Client({ connectionString: localUrl(process.env.DATABASE_URL) })
  await client.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    await client.query('LOCK TABLE contacts, ideas, idea_revisions, approved_revisions IN SHARE ROW EXCLUSIVE MODE')
    let snapshot = await rows(client)
    const empty = Object.values(snapshot).every(found => found.length === 0)
    if (action === 'seed' && empty) {
      await client.query('INSERT INTO contacts (id, normalized_email, created_at) VALUES ($1, $2, $3)', [contactId, 'fixtures@example.invalid', created])
      for (const idea of ideas) {
        await client.query('INSERT INTO ideas (id, author_contact_id, publication_state, location, created_at) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6)', [idea.id, contactId, idea.state, idea.lon, idea.lat, created])
        await client.query('INSERT INTO idea_revisions (id, idea_id, version, content, review_state, created_at) VALUES ($1, $2, 1, $3, $4, $5)', [idea.revision, idea.id, idea.content, idea.review, created])
      }
      await client.query('INSERT INTO approved_revisions (idea_id, revision_id) VALUES ($1, $2)', [ideas[0].id, ideas[0].revision])
      snapshot = await rows(client)
    }
    if (!empty || action === 'seed') check(snapshot)
    if (action === 'clean' && !empty) {
      // Future cascading foreign keys could delete records that this tool does not own.
      const cascading = await client.query(`SELECT conname FROM pg_constraint
        WHERE contype = 'f' AND confrelid = ANY(ARRAY['contacts'::regclass, 'ideas'::regclass, 'idea_revisions'::regclass, 'approved_revisions'::regclass])
        AND confdeltype NOT IN ('a', 'r')`)
      if (cascading.rowCount) throw new Error('Cleanup requires non-cascading foreign keys')
      await client.query('DELETE FROM approved_revisions WHERE idea_id = ANY($1::uuid[])', [ids])
      await client.query('DELETE FROM idea_revisions WHERE id = ANY($1::uuid[])', [revisions])
      await client.query('DELETE FROM ideas WHERE id = ANY($1::uuid[])', [ids])
      await client.query('DELETE FROM contacts WHERE id = $1', [contactId])
    }
    await client.query('COMMIT')
    console.log(action === 'seed' ? 'Local fixtures are ready.' : 'Local fixtures are removed.')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { await client.end() }
}
main().catch(error => { console.error(`Fixture operation refused: ${error.message}`); process.exitCode = 1 })
