import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/idea_map_test_cloudrun') {
  throw new Error('TEST_DATABASE_URL must point to a disposable local idea_map_test_cloudrun database on 127.0.0.1')
}

test('the test runtime role has query access without contact or write grants', async () => {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('BEGIN')
    const sql = await readFile(new URL('./cloud-run-runtime-grants.sql', import.meta.url), 'utf8')
    await client.query(sql)
    const result = await client.query(`
      SELECT
        has_database_privilege('idea_map_cloudrun_test', current_database(), 'CONNECT') AS can_connect,
        has_schema_privilege('idea_map_cloudrun_test', 'public', 'USAGE') AS can_use_schema,
        has_column_privilege('idea_map_cloudrun_test', 'public.ideas', 'id', 'SELECT') AS can_read_idea_id,
        has_column_privilege('idea_map_cloudrun_test', 'public.ideas', 'publication_state', 'SELECT') AS can_read_publication,
        has_column_privilege('idea_map_cloudrun_test', 'public.approved_revisions', 'idea_id', 'SELECT') AS can_read_approved_idea,
        has_column_privilege('idea_map_cloudrun_test', 'public.approved_revisions', 'revision_id', 'SELECT') AS can_read_approved_revision,
        has_column_privilege('idea_map_cloudrun_test', 'public.idea_revisions', 'id', 'SELECT') AS can_read_revision_id,
        has_column_privilege('idea_map_cloudrun_test', 'public.idea_revisions', 'idea_id', 'SELECT') AS can_read_revision_idea,
        has_column_privilege('idea_map_cloudrun_test', 'public.idea_revisions', 'content', 'SELECT') AS can_read_content,
        has_column_privilege('idea_map_cloudrun_test', 'public.idea_revisions', 'review_state', 'SELECT') AS can_read_review_state,
        has_column_privilege('idea_map_cloudrun_test', 'public.ideas', 'author_contact_id', 'SELECT') AS can_read_author,
        has_table_privilege('idea_map_cloudrun_test', 'public.contacts', 'SELECT') AS can_read_contacts,
        has_table_privilege('idea_map_cloudrun_test', 'public.ideas', 'INSERT') AS can_insert_ideas,
        has_schema_privilege('idea_map_cloudrun_test', 'public', 'CREATE') AS can_create_schema_objects
    `)
    assert.deepEqual(result.rows[0], {
      can_connect: true,
      can_use_schema: true,
      can_read_idea_id: true,
      can_read_publication: true,
      can_read_approved_idea: true,
      can_read_approved_revision: true,
      can_read_revision_id: true,
      can_read_revision_idea: true,
      can_read_content: true,
      can_read_review_state: true,
      can_read_author: false,
      can_read_contacts: false,
      can_insert_ideas: false,
      can_create_schema_objects: false,
    })
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})

test('the grants script refuses to change an existing role', async () => {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE ROLE idea_map_cloudrun_test NOLOGIN')
    const sql = await readFile(new URL('./cloud-run-runtime-grants.sql', import.meta.url), 'utf8')
    await assert.rejects(client.query(sql), { message: /Test runtime role already exists/ })
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})
