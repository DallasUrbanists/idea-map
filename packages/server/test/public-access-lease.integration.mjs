import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'
import pg from 'pg'
import { acquirePublicAccessLease } from '../dist/public-access-lease.js'
import { preparePendingRemoval } from '../dist/pending-removal.js'
import { decodeRecoveryRecord, encodeRecoveryIntent } from '../dist/recovery-journal-record.js'
import { pendingRemovalDatabasePool, runtimeDatabasePool } from '../dist/runtime-database.js'
import { readRecoveryJournalRecord, writeRecoveryJournalRecord } from '../dist/recovery-journal-storage.js'

const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://invalid.invalid/invalid')
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/idea_map_test_public_gate') {
  throw new Error('TEST_DATABASE_URL must name the local disposable public-gate test database')
}

async function waitForAborts(...signals) {
  let timer
  try {
    await Promise.race([Promise.all(signals.map(signal => signal.aborted ? Promise.resolve() : once(signal, 'abort'))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Read leases did not abort')), 3000) })])
  } finally { clearTimeout(timer) }
}

test('public-read leases fail closed and drain when a gate writer is waiting', async () => {
  await assert.rejects(acquirePublicAccessLease({ connect: async () => { throw new Error('synthetic sensitive connection details') } }),
    error => error.message === 'Public access unavailable' && !error.message.includes('sensitive'))
  const pool = new pg.Pool({ connectionString: url.toString(), max: 6, connectionTimeoutMillis: 2000 })
  let first, second, writer, late
  try {
    const initial = await pool.query('SELECT is_open FROM public.public_access_gate WHERE singleton = true')
    assert.deepEqual(initial.rows, [{ is_open: false }])
    assert.equal((await pool.query("SELECT has_table_privilege('public', 'public.public_access_gate', 'SELECT') AS allowed")).rows[0].allowed, false)
    await assert.rejects(acquirePublicAccessLease(pool), /Public access unavailable/)
    await pool.query('UPDATE public.public_access_gate SET is_open = true WHERE singleton = true')
    const completed = await acquirePublicAccessLease(pool)
    const releasing = completed.release()
    assert.equal(completed.release(), releasing)
    await releasing
    assert.equal(completed.signal.aborted, true)
    first = await acquirePublicAccessLease(pool)
    second = await acquirePublicAccessLease(pool)
    writer = await pool.connect()
    await writer.query('BEGIN')
    await writer.query("SET LOCAL lock_timeout = '5s'")
    const pid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const closing = writer.query('SELECT pg_advisory_xact_lock(726421, 391)')
    closing.catch(() => {})
    let waiting = false
    for (let attempt = 0; attempt < 50; attempt++) {
      waiting = (await pool.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting', [pid])).rows[0].waiting
      if (waiting) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(waiting, true)
    late = acquirePublicAccessLease(pool)
    late.catch(() => {})
    await waitForAborts(first.signal, second.signal)
    await assert.rejects(first.release(), /Public access unavailable/)
    await assert.rejects(second.release(), /Public access unavailable/)
    await closing
    await writer.query('UPDATE public.public_access_gate SET is_open = false WHERE singleton = true')
    await writer.query('COMMIT')
    await assert.rejects(late, /Public access unavailable/)
    await assert.rejects(first.release(), /Public access unavailable/) // Cleanup is idempotent.
    await pool.query('DELETE FROM public.public_access_gate WHERE singleton = true')
    await assert.rejects(acquirePublicAccessLease(pool), /Public access unavailable/)
  } finally {
    await first?.release().catch(() => {})
    await second?.release().catch(() => {})
    if (writer) { await writer.query('ROLLBACK').catch(() => {}); writer.release() }
    if (late) await late.catch(() => {})
    await pool.query('INSERT INTO public.public_access_gate(singleton, is_open) VALUES (true, false) ON CONFLICT (singleton) DO UPDATE SET is_open = false')
    await pool.end()
  }
})

test('authorized pending removal closes the gate atomically and retries without duplicating the decision', async () => {
  const pool = new pg.Pool({ connectionString: url.toString(), max: 6, connectionTimeoutMillis: 2000 })
  let reader, otherReader, pendingOperationId, secondOperationId, restrictedUrl, restrictedPool, roleCreated = false
  const concurrentOperations = []
  const role = `gate_runtime_${randomUUID().replaceAll('-', '')}`
  try {
    const actor = (await pool.query('INSERT INTO public.users DEFAULT VALUES RETURNING id')).rows[0].id
    await pool.query("INSERT INTO public.identities(user_id, provider, subject) VALUES ($1, 'firebase:demo-idea-map', 'gate-moderator')", [actor])
    await pool.query("INSERT INTO public.moderator_assignments(user_id, granted_by, grant_reason) VALUES ($1,$1,'synthetic authority')", [actor])
    const contact = (await pool.query("INSERT INTO public.contacts(normalized_email) VALUES ('gate@example.invalid') RETURNING id")).rows[0].id
    const idea = (await pool.query("INSERT INTO public.ideas(author_contact_id, publication_state) VALUES ($1,'approved') RETURNING id", [contact])).rows[0].id
    const revision = (await pool.query("INSERT INTO public.idea_revisions(idea_id, version, content, review_state) VALUES ($1,1,'{}'::jsonb,'approved') RETURNING id", [idea])).rows[0].id
    await pool.query('INSERT INTO public.approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [idea, revision])
    await pool.query('UPDATE public.public_access_gate SET is_open = true WHERE singleton = true')
    const session = { uid: 'gate-moderator', email: 'moderator@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verifier = { async verifySessionCookie() { return session }, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: false } } }
    const input = { operationId: randomUUID(), recordId: randomUUID(), ideaId: idea, approvedRevisionId: revision, classification: 'other', reason: 'synthetic removal' }
    pendingOperationId = input.operationId
    const prepare = (v = verifier, change = {}) => preparePendingRemoval(url.toString(), 'demo-idea-map', 'synthetic-cookie', v, 'dev', { ...input, ...change })
    let checks = 0
    const revoked = { ...verifier, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: ++checks > 1 } } }
    assert.deepEqual(await prepare(revoked), { state: 'unauthenticated' })
    assert.deepEqual(await prepare(verifier, { approvedRevisionId: randomUUID() }), { state: 'authorized', value: 'stale' })
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, true)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM public.public_access_pending_decisions')).rows[0].count, 0)
    reader = await acquirePublicAccessLease(runtimeDatabasePool(url.toString()))
    otherReader = await acquirePublicAccessLease(runtimeDatabasePool(url.toString()))
    const closing = prepare()
    closing.catch(() => {})
    let waiting = false
    for (let attempt = 0; attempt < 50; attempt++) {
      waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting")).rows[0].waiting
      if (waiting) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(waiting, true)
    await waitForAborts(reader.signal, otherReader.signal)
    await assert.rejects(reader.release(), /Public access unavailable/)
    await assert.rejects(otherReader.release(), /Public access unavailable/)
    const prepared = await closing
    assert.equal(prepared.state, 'authorized')
    assert.equal(prepared.value.state, 'pending')
    assert.equal(prepared.value.recordId, input.recordId)
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
    assert.equal((await pool.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'approved')
    const rows = (await pool.query('SELECT record_id, approved_revision_id, removal_reason, intent FROM public.public_access_pending_decisions WHERE operation_id=$1', [input.operationId])).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].record_id, input.recordId)
    assert.equal(rows[0].approved_revision_id, revision)
    assert.equal(rows[0].removal_reason, input.reason)
    const intent = decodeRecoveryRecord(Buffer.from(rows[0].intent), 'dev')
    assert.equal(intent.actorId, actor)
    assert.equal(intent.ideaId, idea)
    assert.equal(intent.decision.reason, 'Authorized removal')
    assert.ok(!rows[0].intent.includes(input.reason))
    assert.deepEqual(Buffer.from(prepared.value.payload), Buffer.from(rows[0].intent))
    const retried = await prepare()
    assert.deepEqual(retried, prepared)
    let stored
    const journal = ambiguous => ({ bucket: () => ({ file: () => ({ createWriteStream: () => {
      const chunks = []
      return new Writable({
        write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
        final(callback) {
          if (stored) return callback(new Error('synthetic precondition failure'))
          stored = Buffer.concat(chunks)
          callback(ambiguous ? new Error('synthetic lost response') : undefined)
        },
      })
    } }) }) })
    const target = { environment: 'dev', bucket: 'synthetic-private-backups' }
    const emulator = process.env.STORAGE_EMULATOR_HOST
    delete process.env.STORAGE_EMULATOR_HOST
    try {
      await assert.rejects(writeRecoveryJournalRecord(journal(true), target, prepared.value.recordId, prepared.value.payload), /outcome is uncertain/)
      assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
      await assert.rejects(writeRecoveryJournalRecord(journal(false), target, retried.value.recordId, retried.value.payload), /outcome is uncertain/)
      const independentReader = { bucket: () => ({ file: () => ({ interceptors: [], createReadStream: () => {
        const stream = Readable.from([stored])
        process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: {
          'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': 'crc32c=AAAAAA==',
        } }) }))
        return stream
      } }) }) }
      const observed = await readRecoveryJournalRecord(independentReader, target, prepared.value.recordId, '101')
      assert.deepEqual(Buffer.from(observed), Buffer.from(retried.value.payload))
    } finally {
      if (emulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
      else process.env.STORAGE_EMULATOR_HOST = emulator
    }
    assert.deepEqual(stored, Buffer.from(rows[0].intent))
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
    await assert.rejects(prepare(verifier, { recordId: randomUUID() }), /Pending removal unavailable/)
    await assert.rejects(prepare(verifier, { reason: 'different synthetic reason' }), /Pending removal unavailable/)
    await assert.rejects(prepare(verifier, { reason: '\ud800' }), /Invalid pending removal/)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM public.public_access_pending_decisions')).rows[0].count, 1)
    assert.equal((await pool.query("SELECT has_table_privilege('public', 'public.public_access_pending_decisions', 'SELECT') AS allowed")).rows[0].allowed, false)
    const functionName = 'public.prepare_pending_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text)'
    assert.equal((await pool.query('SELECT has_function_privilege($1,$2,$3) AS allowed', ['public', functionName, 'EXECUTE'])).rows[0].allowed, false)
    await pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'synthetic-only'`)
    roleCreated = true
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await pool.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), ${functionName} TO "${role}"`)
    restrictedUrl = new URL(url)
    restrictedUrl.username = role
    restrictedUrl.password = 'synthetic-only'
    restrictedPool = new pg.Pool({ connectionString: restrictedUrl.toString() })
    await assert.rejects(restrictedPool.query('UPDATE public.public_access_gate SET is_open=true'), { code: '42501' })
    await assert.rejects(restrictedPool.query('SELECT * FROM public.public_access_pending_decisions'), { code: '42501' })
    await assert.rejects(restrictedPool.query('UPDATE public.ideas SET publication_state=$1 WHERE id=$2', ['withdrawn', idea]), { code: '42501' })
    await assert.rejects(restrictedPool.query('SELECT public.remove_published_idea($1,$2,$3,$4,$5,$6)',
      ['firebase:demo-idea-map', session.uid, idea, revision, 'other', 'synthetic']), { code: '42501' })
    secondOperationId = randomUUID()
    const secondRecordId = randomUUID()
    const validIntent = Buffer.from(encodeRecoveryIntent({ operationId: secondOperationId, environment: 'dev', ideaId: idea,
      actorId: actor, authorizedAt: '2026-11-03T12:00:00.000Z',
      decision: { kind: 'removal', classification: 'other', reason: 'Authorized removal' } })).toString('utf8')
    for (const unsafe of [validIntent.replace('"version":1', '"version":1,"version":1'),
      validIntent.replace(',"decision":', ',"extra":"synthetic private text","decision":'),
      validIntent.replace('"Authorized removal"', '"synthetic private text"')]) {
      await assert.rejects(restrictedPool.query('SELECT public.prepare_pending_removal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        ['firebase:demo-idea-map', session.uid, idea, revision, secondOperationId, secondRecordId, 'dev', 'other', input.reason, unsafe]), { code: 'P0001' })
    }
    const limited = await preparePendingRemoval(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, 'dev',
      { ...input, operationId: secondOperationId, recordId: secondRecordId })
    assert.equal(limited.state, 'authorized')
    assert.equal(limited.value.state, 'pending')
    assert.equal(limited.value.recordId, secondRecordId)
    const concurrent = Array.from({ length: 2 }, () => ({ operationId: randomUUID(), recordId: randomUUID() }))
    concurrentOperations.push(...concurrent.map(item => item.operationId))
    const outcomes = await Promise.all(concurrent.map(item => prepare(verifier, item)))
    assert.ok(outcomes.every(result => result.state === 'authorized' && result.value.state === 'pending'))
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM public.public_access_pending_decisions')).rows[0].count, 4)
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
  } finally {
    await reader?.release().catch(() => {})
    await otherReader?.release().catch(() => {})
    await runtimeDatabasePool(url.toString()).end()
    await pendingRemovalDatabasePool(url.toString()).end()
    if (restrictedUrl) await pendingRemovalDatabasePool(restrictedUrl.toString()).end()
    if (restrictedPool) await restrictedPool.end()
    if (pendingOperationId) await pool.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id = $1', [pendingOperationId])
    if (secondOperationId) await pool.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id = $1', [secondOperationId])
    if (concurrentOperations.length) await pool.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id = ANY($1::uuid[])', [concurrentOperations])
    await pool.query('UPDATE public.public_access_gate SET is_open = false WHERE singleton = true')
    if (roleCreated) {
      await pool.query(`REVOKE EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.prepare_pending_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text) FROM "${role}"`)
      await pool.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`)
      await pool.query(`DROP ROLE "${role}"`)
    }
    await pool.end()
  }
})

test('a lost database connection aborts the lease and prevents successful release', async () => {
  const pool = new pg.Pool({ connectionString: url.toString(), max: 3, connectionTimeoutMillis: 2000 })
  let lease
  try {
    await pool.query('UPDATE public.public_access_gate SET is_open = true WHERE singleton = true')
    lease = await acquirePublicAccessLease(pool)
    const pid = (await lease.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const aborted = once(lease.signal, 'abort')
    assert.equal((await pool.query('SELECT pg_terminate_backend($1) AS terminated', [pid])).rows[0].terminated, true)
    let timer
    try { await Promise.race([aborted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Lease did not abort')), 3000) })]) }
    finally { clearTimeout(timer) }
    assert.equal(lease.signal.aborted, true)
    await assert.rejects(lease.release(), /Public access unavailable/)
  } finally {
    await lease?.release().catch(() => {})
    await pool.query('UPDATE public.public_access_gate SET is_open = false WHERE singleton = true')
    await pool.end()
  }
})

test('a limited read role detects a waiting closer without permission to update the gate', async () => {
  const admin = new pg.Pool({ connectionString: url.toString(), max: 3, connectionTimeoutMillis: 2000 })
  const role = `gate_reader_${randomUUID().replaceAll('-', '')}`
  let roleCreated = false, restricted, lease, writer, closing
  try {
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'synthetic-only'`)
    roleCreated = true
    await admin.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await admin.query(`GRANT SELECT (singleton, is_open) ON public.public_access_gate TO "${role}"`)
    await admin.query('UPDATE public.public_access_gate SET is_open=true WHERE singleton=true')
    const restrictedUrl = new URL(url)
    restrictedUrl.username = role
    restrictedUrl.password = 'synthetic-only'
    restricted = new pg.Pool({ connectionString: restrictedUrl.toString(), max: 1 })
    await assert.rejects(restricted.query('UPDATE public.public_access_gate SET is_open=false'), { code: '42501' })
    lease = await acquirePublicAccessLease(restricted)
    writer = await admin.connect()
    await writer.query('BEGIN')
    await writer.query("SET LOCAL lock_timeout = '5s'")
    closing = writer.query('SELECT pg_catalog.pg_advisory_xact_lock(726421, 391)')
    closing.catch(() => {})
    await waitForAborts(lease.signal)
    await assert.rejects(lease.release(), /Public access unavailable/)
    await closing
    await writer.query('UPDATE public.public_access_gate SET is_open=false WHERE singleton=true')
    await writer.query('COMMIT')
  } finally {
    await lease?.release().catch(() => {})
    if (closing) await closing.catch(() => {})
    if (writer) { await writer.query('ROLLBACK').catch(() => {}); writer.release() }
    if (restricted) await restricted.end()
    await admin.query('UPDATE public.public_access_gate SET is_open=false WHERE singleton=true')
    if (roleCreated) {
      await admin.query(`REVOKE SELECT (singleton, is_open) ON public.public_access_gate FROM "${role}"`)
      await admin.query(`REVOKE USAGE ON SCHEMA public FROM "${role}"`)
      await admin.query(`DROP ROLE "${role}"`)
    }
    await admin.end()
  }
})
