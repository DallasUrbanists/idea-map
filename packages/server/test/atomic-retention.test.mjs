import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.startsWith('/idea_map_test_')) throw new Error('TEST_DATABASE_URL must name a disposable database beginning idea_map_test_')

test('metadata retention is atomic, scoped, and serialized with legal holds', async () => {
  const pool = new pg.Pool({ connectionString: url, max: 6 })
  const role = `atomic_retention_${randomBytes(8).toString('hex')}`
  let roleCreated = false
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'migrations' })
    const actor = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map','director')", [actor])
    await pool.query("INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ($1,'executive_director','synthetic',$1)", [actor])
    const contact = (await pool.query("INSERT INTO contacts(normalized_email) VALUES ('retention@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO idea_revisions(idea_id,version,content,review_state) VALUES ($1,1,'{\"text\":\"synthetic\"}','approved') RETURNING id", [idea])).rows[0].id
    await pool.query('INSERT INTO approval_records(idea_id,revision_id,verified_for_trust) VALUES ($1,$2,true)', [idea, revision])
    await pool.query("INSERT INTO moderation_events(revision_id,actor_id,state,reason,created_at) VALUES ($1,$2,'approved','old',clock_timestamp()-interval '91 days'),($1,$2,'rejected','recent',clock_timestamp()-interval '89 days')", [revision, actor])
    await pool.query("INSERT INTO approval_corrections(idea_id,actor_id,excluded,reason,created_at) VALUES ($1,$2,true,'old',clock_timestamp()-interval '91 days'),($1,$2,false,'recent',clock_timestamp()-interval '89 days')", [idea, actor])
    await pool.query("INSERT INTO moderator_change_requests(idea_id,requested_revision_id,requested_by,reason,created_at,resolved_revision_id,resolved_by,resolved_at,resolution_reason) VALUES ($1,$2,$3,'old',clock_timestamp()-interval '92 days',$2,$3,clock_timestamp()-interval '91 days','resolved')", [idea, revision, actor])
    await pool.query("INSERT INTO moderator_change_requests(idea_id,requested_revision_id,requested_by,reason) VALUES ($1,$2,$3,'active')", [idea, revision, actor])
    await pool.query("INSERT INTO moderator_holds(revision_id,placed_by,reason,created_at,released_by,released_at,release_reason) VALUES ($1,$2,'old',clock_timestamp()-interval '92 days',$2,clock_timestamp()-interval '91 days','resolved')", [revision, actor])
    await pool.query("INSERT INTO moderator_holds(revision_id,placed_by,reason) VALUES ($1,$2,'active')", [revision, actor])
    const job = (await pool.query("INSERT INTO jobs(kind,idempotency_key,revision_id,scheduled_at) VALUES ('projection','synthetic-retention',$1,clock_timestamp()) RETURNING id", [revision])).rows[0].id
    await pool.query("INSERT INTO moderator_removals(idea_id,revision_id,actor_id,classification,reason,projection_job_id,created_at) VALUES ($1,$2,$3,'other','old',$4,clock_timestamp()-interval '91 days')", [idea, revision, actor, job])
    await pool.query("INSERT INTO guest_email_verifications(id,idea_id,contact_id,secret_digest,email_mac,created_at,expires_at) VALUES (gen_random_uuid(),$1,$2,repeat('a',64),repeat('b',64),clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day'),(gen_random_uuid(),$1,$2,repeat('c',64),repeat('d',64),clock_timestamp(),clock_timestamp()+interval '1 hour')", [idea, contact])
    const legal = (await pool.query("SELECT public.place_legal_hold('firebase:demo-idea-map','director',$1,'synthetic-case','synthetic hold') AS id", [idea])).rows[0].id
    const blocked = { blocked: true, decisions_deleted: 0, corrections_deleted: 0, requests_deleted: 0, holds_deleted: 0, removals_deleted: 0, proofs_deleted: 0 }
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_idea_expired_metadata($1)', [idea])).rows[0], blocked)
    await pool.query("SELECT public.release_legal_hold('firebase:demo-idea-map','director',$1,'synthetic release',NULL)", [legal])
    await pool.query("CREATE FUNCTION public.synthetic_abort_prune() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic prune failure'; END $$")
    await pool.query('CREATE TRIGGER synthetic_abort_prune BEFORE DELETE ON moderator_removals FOR EACH ROW EXECUTE FUNCTION public.synthetic_abort_prune()')
    try {
      await assert.rejects(pool.query('SELECT * FROM public.prune_idea_expired_metadata($1)', [idea]), /synthetic prune failure/)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM moderation_events WHERE revision_id=$1 AND reason='old'", [revision])).rows[0].n, 1)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM moderator_change_requests WHERE idea_id=$1 AND reason='old'", [idea])).rows[0].n, 1)
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1 AND reason='old'", [revision])).rows[0].n, 1)
    } finally {
      await pool.query('DROP TRIGGER synthetic_abort_prune ON moderator_removals')
      await pool.query('DROP FUNCTION public.synthetic_abort_prune()')
    }
    assert.deepEqual((await pool.query('SELECT * FROM public.prune_idea_expired_metadata($1)', [idea])).rows[0], { blocked: false, decisions_deleted: 1, corrections_deleted: 1, requests_deleted: 1, holds_deleted: 1, removals_deleted: 1, proofs_deleted: 1 })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderation_events WHERE revision_id=$1', [revision])).rows[0].n, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_corrections WHERE idea_id=$1', [idea])).rows[0].n, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_holds WHERE revision_id=$1 AND released_at IS NULL', [revision])).rows[0].n, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM moderator_change_requests WHERE idea_id=$1 AND resolved_at IS NULL', [idea])).rows[0].n, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM guest_email_verifications WHERE idea_id=$1', [idea])).rows[0].n, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_records WHERE idea_id=$1', [idea])).rows[0].n, 1)
    assert.deepEqual((await pool.query('SELECT content FROM idea_revisions WHERE id=$1', [revision])).rows[0].content, { text: 'synthetic' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM legal_holds WHERE id=$1', [legal])).rows[0].n, 1)
    const strict = await pool.connect()
    try {
      await strict.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      assert.deepEqual((await strict.query('SELECT * FROM public.prune_idea_expired_metadata($1)', [idea])).rows[0], blocked)
      await strict.query('ROLLBACK')
    } finally { strict.release() }
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`)
    roleCreated = true
    const limited = await pool.connect()
    try {
      await limited.query(`SET ROLE "${role}"`)
      await assert.rejects(limited.query('SELECT * FROM public.prune_idea_expired_metadata($1)', [idea]), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM moderation_events'), { code: '42501' })
      await limited.query('RESET ROLE')
      await pool.query(`GRANT EXECUTE ON FUNCTION public.prune_idea_expired_metadata(uuid) TO "${role}"`)
      await limited.query(`SET ROLE "${role}"`)
      assert.deepEqual((await limited.query('SELECT * FROM public.prune_idea_expired_metadata($1)', [idea])).rows[0], { blocked: false, decisions_deleted: 0, corrections_deleted: 0, requests_deleted: 0, holds_deleted: 0, removals_deleted: 0, proofs_deleted: 0 })
      await assert.rejects(limited.query('SELECT * FROM moderation_events'), { code: '42501' })
    } finally { await limited.query('RESET ROLE'); limited.release() }
    const raced = (await pool.query('INSERT INTO ideas(author_contact_id) VALUES ($1) RETURNING id', [contact])).rows[0].id
    const holdTx = await pool.connect()
    try {
      await holdTx.query('BEGIN')
      await holdTx.query("SELECT public.place_legal_hold('firebase:demo-idea-map','director',$1,'race','synthetic hold')", [raced])
      const retention = pool.query('SELECT * FROM public.prune_idea_expired_metadata($1)', [raced])
      assert.equal(await Promise.race([retention.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 100))]), 'waiting')
      await holdTx.query('COMMIT')
      assert.deepEqual((await retention).rows[0], blocked)
    } finally { await holdTx.query('ROLLBACK'); holdTx.release() }
  } finally {
    if (roleCreated) { await pool.query(`DROP OWNED BY "${role}"`); await pool.query(`DROP ROLE "${role}"`) }
    await pool.end()
  }
})
