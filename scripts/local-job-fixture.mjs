import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const { Client } = require('pg')
const ids = {
  contact: 'a16b6e1b-95d5-42bd-b970-f6626538e001', idea: 'a16b6e1b-95d5-42bd-b970-f6626538e002',
  revision: 'a16b6e1b-95d5-42bd-b970-f6626538e003', job: 'a16b6e1b-95d5-42bd-b970-f6626538e004',
  outbox: 'a16b6e1b-95d5-42bd-b970-f6626538e005',
}
const assessment = 'synthetic-local-job-fixture-v1'
const content = { title: 'Synthetic crossing idea', description: 'A local-only fixture.' }

export function validateFixtureUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('A local fixture database URL is required') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '54329' ||
      url.username !== 'idea_map' || url.search || url.hash ||
      !(url.pathname === '/idea_map_dev' || /^\/idea_map_test_[a-z0-9_]+$/.test(url.pathname))) {
    throw new Error('Fixture database must be the local Idea Map database on 127.0.0.1:54329')
  }
  return value
}

async function transaction(client, action) {
  await client.query('BEGIN')
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('idea-map-local-job-fixture-v1', 0))")
    const result = await action()
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error }
}

async function hasMarker(client) {
  const result = await client.query('SELECT revision_id, kind, idempotency_key FROM jobs WHERE id=$1 FOR UPDATE', [ids.job])
  if (!result.rowCount) return false
  if (result.rows[0].revision_id !== ids.revision || result.rows[0].kind !== 'synthetic-fixture' || result.rows[0].idempotency_key !== assessment) throw new Error('Fixture marker conflicts with existing data')
  return true
}

async function verifyOwnedRows(client) {
  const result = await client.query(`SELECT 1 FROM contacts c JOIN ideas i ON i.author_contact_id=c.id
    JOIN idea_revisions r ON r.idea_id=i.id JOIN revision_assessments a ON a.revision_id=r.id
    JOIN review_gates g ON g.revision_id=r.id JOIN jobs j ON j.revision_id=r.id
    JOIN outbox o ON o.job_id=j.id WHERE c.id=$1 AND c.normalized_email='job-fixture@example.invalid'
      AND i.id=$2 AND i.owner_id IS NULL AND r.id=$3 AND r.version=1 AND r.content=$4::jsonb
      AND a.id=$5 AND a.fingerprint=$6 AND j.id=$7 AND j.idempotency_key=$5
      AND j.assessment_id=$5 AND j.kind='synthetic-fixture' AND o.id=$8 FOR UPDATE OF c,i,r,a,g,j,o`,
  [ids.contact, ids.idea, ids.revision, JSON.stringify(content), assessment, 'a'.repeat(64), ids.job, ids.outbox])
  if (!result.rowCount) throw new Error('Fixture records changed or are incomplete; no cleanup was performed')
}

export async function seedLocalJobFixture(client) {
  return transaction(client, async () => {
    if (await hasMarker(client)) { await verifyOwnedRows(client); return 'already-seeded' }
    // Explicit IDs never overwrite an existing record; any collision rolls back.
    await client.query("INSERT INTO contacts(id,normalized_email,created_at) VALUES ($1,'job-fixture@example.invalid','2026-01-01T00:00:00Z')", [ids.contact])
    await client.query("INSERT INTO ideas(id,author_contact_id,created_at) VALUES ($1,$2,'2026-01-01T00:00:00Z')", [ids.idea, ids.contact])
    await client.query("INSERT INTO idea_revisions(id,idea_id,version,content,created_at) VALUES ($1,$2,1,$3,'2026-01-01T00:00:00Z')", [ids.revision, ids.idea, content])
    await client.query('INSERT INTO review_gates(revision_id) VALUES ($1)', [ids.revision])
    await client.query(`INSERT INTO revision_assessments(id,revision_id,fingerprint,received_at,deadline,wait_milliseconds)
      VALUES ($1,$2,$3,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z',86400000)`, [assessment, ids.revision, 'a'.repeat(64)])
    // The fixture starts terminal and acknowledged so a repair process cannot dispatch it.
    await client.query(`INSERT INTO jobs(id,revision_id,kind,idempotency_key,assessment_id,assessment_received_at,scheduled_at,state,created_at)
      VALUES ($1,$2,'synthetic-fixture',$3,$3,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','stale','2026-01-01T00:00:00Z')`, [ids.job, ids.revision, assessment])
    await client.query("INSERT INTO outbox(id,job_id,published_at,created_at) VALUES ($1,$2,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')", [ids.outbox, ids.job])
    return 'seeded'
  })
}

export async function cleanLocalJobFixture(client) {
  return transaction(client, async () => {
    if (!await hasMarker(client)) return 'absent'
    await verifyOwnedRows(client)
    // No cascading deletes: references outside the fixture cause a full rollback.
    for (const [sql, value] of [
      ['DELETE FROM outbox WHERE id=$1', ids.outbox], ['DELETE FROM jobs WHERE id=$1', ids.job],
      ['DELETE FROM revision_assessments WHERE id=$1', assessment], ['DELETE FROM review_gates WHERE revision_id=$1', ids.revision],
      ['DELETE FROM idea_revisions WHERE id=$1', ids.revision],
      ['DELETE FROM ideas WHERE id=$1', ids.idea], ['DELETE FROM contacts WHERE id=$1', ids.contact],
    ]) {
      const removed = await client.query(sql, [value])
      if (removed.rowCount !== 1) throw new Error('Fixture records changed; cleanup rolled back')
    }
    return 'cleaned'
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2]
  if (!['seed', 'clean'].includes(mode) || process.argv.length !== 3) throw new Error('Use seed or clean')
  const client = new Client({ connectionString: validateFixtureUrl(process.env.IDEA_MAP_FIXTURE_DATABASE_URL) })
  try { await client.connect(); console.log(await (mode === 'seed' ? seedLocalJobFixture(client) : cleanLocalJobFixture(client))) }
  catch { console.error('Fixture operation failed; the transaction was rolled back. Check the local database and fixture ownership.'); process.exitCode = 1 }
  finally { await client.end() }
}
