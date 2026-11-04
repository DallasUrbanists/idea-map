import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'
import pg from 'pg'
import { CRC32C } from '@google-cloud/storage'
import { acquirePublicAccessLease, publicAccessLeaseClient } from '../dist/public-access-lease.js'
import { applyJournaledRemoval, prepareAndJournalRemoval, preparePendingRemoval, prepareRemovalConfirmation, verifyRemovalConfirmation, writeRemovalConfirmation } from '../dist/pending-removal.js'
import { decodeRecoveryRecord, encodeRecoveryIntent, recoveryConfirmationRecordId } from '../dist/recovery-journal-record.js'
import { pendingRemovalDatabasePool, runtimeDatabasePool } from '../dist/runtime-database.js'
import { compareCurrentRecoveryJournalRecord, readRecoveryJournalRecord, writeRecoveryJournalRecord } from '../dist/recovery-journal-storage.js'

const bucketMetadata = async () => [{ name: 'synthetic-private-backups', projectNumber: '123456789',
  iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
  versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }]

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
  const journalOperations = []
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
    // The pending decision and gate commit even while readers still hold their
    // shared locks. They must not require the later exclusive drain to finish.
    const prepared = await prepare()
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
    await assert.rejects(acquirePublicAccessLease(pool), /Public access unavailable/)
    await waitForAborts(reader.signal, otherReader.signal)
    await assert.rejects(reader.release(), /Public access unavailable/)
    await assert.rejects(otherReader.release(), /Public access unavailable/)
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
    const journal = ambiguous => ({ bucket: () => ({ getMetadata: bucketMetadata, file: () => ({ createWriteStream: () => {
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
    const target = { environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789' }
    const emulator = process.env.STORAGE_EMULATOR_HOST
    delete process.env.STORAGE_EMULATOR_HOST
    try {
      await assert.rejects(writeRecoveryJournalRecord(journal(true), target, prepared.value.recordId, prepared.value.payload), /outcome is uncertain/)
      assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
      await assert.rejects(writeRecoveryJournalRecord(journal(false), target, retried.value.recordId, retried.value.payload), /outcome is uncertain/)
      const independentReader = { bucket: () => ({ getMetadata: bucketMetadata, file: () => ({ interceptors: [], createReadStream: () => {
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
    const objects = new Map()
    const stagedJournal = lostResponse => ({ bucket: () => ({ getMetadata: bucketMetadata, file: name => ({ createWriteStream: () => {
      const chunks = []
      return new Writable({
        write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
        final(callback) {
          if (objects.has(name)) return callback(new Error('synthetic precondition failure'))
          objects.set(name, Buffer.concat(chunks))
          callback(lostResponse ? new Error('synthetic lost response') : undefined)
        },
      })
    } }) }) })
    const uncertainInput = { ...input, operationId: randomUUID(), recordId: randomUUID() }
    const successfulInput = { ...input, operationId: randomUUID(), recordId: randomUUID() }
    const wrongBucketInput = { ...input, operationId: randomUUID(), recordId: randomUUID() }
    journalOperations.push(uncertainInput.operationId, successfulInput.operationId, wrongBucketInput.operationId)
    const originalEmulator = process.env.STORAGE_EMULATOR_HOST
    delete process.env.STORAGE_EMULATOR_HOST
    try {
      const stage = (storage, decision) => prepareAndJournalRemoval(url.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, target, storage, decision)
      assert.deepEqual(await stage(stagedJournal(true), uncertainInput), { state: 'authorized', value: 'journal_uncertain' })
      assert.deepEqual(await stage(stagedJournal(false), uncertainInput), { state: 'authorized', value: 'journal_uncertain' })
      assert.deepEqual(await stage(stagedJournal(false), successfulInput), { state: 'authorized', value: 'journaled' })
      let wrongBucketObjectRequests = 0
      const wrongBucket = { bucket: () => ({ async getMetadata() { return [{ ...(await bucketMetadata())[0], projectNumber: '987654321' }] },
        file() { wrongBucketObjectRequests++; throw new Error('Unexpected object write') },
      }) }
      assert.deepEqual(await stage(wrongBucket, wrongBucketInput), { state: 'authorized', value: 'journal_uncertain' })
      assert.equal(wrongBucketObjectRequests, 0)
      assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM public.public_access_pending_decisions WHERE operation_id=$1',
        [wrongBucketInput.operationId])).rows[0].count, 1)
    } finally {
      if (originalEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
      else process.env.STORAGE_EMULATOR_HOST = originalEmulator
    }
    assert.equal(objects.size, 2)
    assert.ok([...objects.values()].every(value => !value.toString('utf8').includes(input.reason)))
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
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
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM public.public_access_pending_decisions')).rows[0].count,
      1 + journalOperations.length + 1 + concurrentOperations.length)
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
    if (journalOperations.length) await pool.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id = ANY($1::uuid[])', [journalOperations])
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
    const pid = (await publicAccessLeaseClient(lease).query('SELECT pg_backend_pid() AS pid')).rows[0].pid
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

test('a trusted coordinator applies only the verified pending removal after readers drain', async () => {
  const admin = new pg.Pool({ connectionString: url.toString(), max: 6, connectionTimeoutMillis: 2000 })
  const suffix = randomUUID().replaceAll('-', '')
  const prepareRole = `gate_prepare_${suffix}`
  const coordinatorRole = `gate_coordinator_${suffix}`
  const subject = `apply-${suffix}`
  const prepareFunction = 'public.prepare_pending_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text)'
  const applyFunction = 'public.apply_pending_removal(text,text,uuid,uuid,text,text)'
  const confirmationFunction = 'public.prepare_pending_removal_confirmation(text,text,uuid,uuid,text,text,timestamptz,uuid)'
  const verificationFunction = 'public.verify_pending_removal_confirmation(text,text,uuid,uuid,timestamptz,text)'
  const prepareUrl = new URL(url)
  const coordinatorUrl = new URL(url)
  let reader, actor, contact, idea, revision, operationId, preview, staleIdea, staleRevision, staleOperation, applying
  let preparePool, coordinatorPool, prepareUsed = false, coordinatorUsed = false
  const createdRoles = []
  const originalEmulator = process.env.STORAGE_EMULATOR_HOST
  delete process.env.STORAGE_EMULATOR_HOST
  try {
    actor = (await admin.query('INSERT INTO public.users DEFAULT VALUES RETURNING id')).rows[0].id
    await admin.query("INSERT INTO public.identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map',$2)", [actor, subject])
    await admin.query("INSERT INTO public.moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic authority')", [actor])
    contact = (await admin.query('INSERT INTO public.contacts(normalized_email) VALUES ($1) RETURNING id', [`${suffix}@example.invalid`])).rows[0].id
    idea = (await admin.query("INSERT INTO public.ideas(author_contact_id,publication_state) VALUES ($1,'approved') RETURNING id", [contact])).rows[0].id
    revision = (await admin.query("INSERT INTO public.idea_revisions(idea_id,version,content,review_state) VALUES ($1,1,'{}'::jsonb,'approved') RETURNING id", [idea])).rows[0].id
    await admin.query('INSERT INTO public.approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [idea, revision])
    preview = (await admin.query("INSERT INTO public.media_previews(idea_id,revision_id,object_name,generation,content_type,published) VALUES ($1,$2,$3,'1','image/png',true) RETURNING id", [idea, revision, `synthetic/${suffix}`])).rows[0].id
    await admin.query(`CREATE ROLE "${prepareRole}" LOGIN PASSWORD 'synthetic-only'`)
    createdRoles.push(prepareRole)
    await admin.query(`CREATE ROLE "${coordinatorRole}" LOGIN PASSWORD 'synthetic-only'`)
    createdRoles.push(coordinatorRole)
    await admin.query(`GRANT USAGE ON SCHEMA public TO "${prepareRole}", "${coordinatorRole}"`)
    await admin.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), ${prepareFunction} TO "${prepareRole}"`)
    await admin.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), ${applyFunction}, ${confirmationFunction}, ${verificationFunction} TO "${coordinatorRole}"`)
    prepareUrl.username = prepareRole; prepareUrl.password = 'synthetic-only'
    coordinatorUrl.username = coordinatorRole; coordinatorUrl.password = 'synthetic-only'
    preparePool = new pg.Pool({ connectionString: prepareUrl.toString() })
    coordinatorPool = new pg.Pool({ connectionString: coordinatorUrl.toString() })
    await assert.rejects(preparePool.query(`SELECT * FROM ${applyFunction.slice(0, applyFunction.indexOf('('))}($1,$2,$3,$4,$5,$6)`,
      ['firebase:demo-idea-map', subject, randomUUID(), randomUUID(), '1', '{}']), { code: '42501' })
    await assert.rejects(coordinatorPool.query('SELECT public.remove_published_idea($1,$2,$3,$4,$5,$6)',
      ['firebase:demo-idea-map', subject, idea, revision, 'other', 'synthetic']), { code: '42501' })
    await assert.rejects(coordinatorPool.query('SELECT * FROM public.public_access_pending_decisions'), { code: '42501' })
    assert.equal((await admin.query('SELECT has_function_privilege($1,$2,$3) AS allowed', ['public', applyFunction, 'EXECUTE'])).rows[0].allowed, false)
    assert.equal((await admin.query('SELECT has_function_privilege($1,$2,$3) AS allowed', ['public', confirmationFunction, 'EXECUTE'])).rows[0].allowed, false)
    assert.equal((await admin.query('SELECT has_function_privilege($1,$2,$3) AS allowed', ['public', verificationFunction, 'EXECUTE'])).rows[0].allowed, false)
    const session = { uid: subject, email: `${suffix}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verifier = { async verifySessionCookie() { return session }, async getUser() { return { uid: subject, email: session.email, emailVerified: true, disabled: false } } }
    const input = { operationId: randomUUID(), recordId: randomUUID(), ideaId: idea, approvedRevisionId: revision,
      classification: 'other', reason: 'synthetic private reason' }
    operationId = input.operationId
    await admin.query('UPDATE public.public_access_gate SET is_open=true WHERE singleton=true')
    reader = await acquirePublicAccessLease(admin)
    prepareUsed = true
    const prepared = await preparePendingRemoval(prepareUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, 'dev', input)
    assert.equal(prepared.state, 'authorized')
    assert.equal(prepared.value.state, 'pending')
    await assert.rejects(admin.query('UPDATE public.public_access_pending_decisions SET applied_at=clock_timestamp() WHERE operation_id=$1', [operationId]), { code: '23514' })
    await assert.rejects(admin.query("UPDATE public.public_access_pending_decisions SET journal_generation='1' WHERE operation_id=$1", [operationId]), /application is immutable/)
    await assert.rejects(admin.query("UPDATE public.public_access_pending_decisions SET journal_generation='1',applied_at=clock_timestamp(),applied_transaction_id='1' WHERE operation_id=$1", [operationId]), /Pending removal is ambiguous/)
    await waitForAborts(reader.signal)
    const body = Buffer.from(prepared.value.payload)
    const checksum = new CRC32C(); checksum.update(body)
    const target = { environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789' }
    let reads = 0
    const fakeReader = (payload = body, crc = checksum.toString(), generation = '90071992547409931234') => ({ bucket: bucket => ({ getMetadata: bucketMetadata, file: name => ({
      interceptors: [], async getMetadata() { reads++; return [{ bucket, name, generation, metageneration: '1', size: String(payload.length),
        contentType: 'application/json', crc32c: crc }] },
      createReadStream() {
        const stream = Readable.from([payload])
        process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: {
          'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': `crc32c=${crc}`,
        } }) }))
        return stream
      },
    }) }) })
    const argumentsFor = { operationId, recordId: input.recordId, payload: body }
    const execute = (v = verifier, source = fakeReader(), value = argumentsFor) => {
      coordinatorUsed = true
      return applyJournaledRemoval(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', v, target, source, value)
    }
    const unauthenticated = { ...verifier, async verifySessionCookie() { throw Object.assign(new Error('synthetic'), { code: 'auth/session-cookie-revoked' }) } }
    assert.deepEqual(await execute(unauthenticated), { state: 'unauthenticated' })
    assert.equal(reads, 0)
    await assert.rejects(execute(verifier, fakeReader(), { ...argumentsFor, payload: Buffer.alloc(16_385) }), /Invalid pending removal/)
    assert.equal(reads, 0)
    const incorrectChecksum = checksum.toString() === 'AAAAAA==' ? 'AQAAAA==' : 'AAAAAA=='
    assert.deepEqual(await execute(verifier, fakeReader(body, incorrectChecksum)), { state: 'authorized', value: 'journal_uncertain' })
    assert.equal((await admin.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'approved')
    let checks = 0
    const revoked = { ...verifier, async getUser() { return { uid: subject, email: session.email, emailVerified: true, disabled: ++checks > 1 } } }
    applying = execute(revoked)
    applying.catch(() => {})
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt++) {
      waiting = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted) AS waiting")).rows[0].waiting
      if (waiting) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(waiting, true)
    await assert.rejects(reader.release(), /Public access unavailable/)
    reader = undefined
    assert.deepEqual(await applying, { state: 'unauthenticated' })
    applying = undefined
    assert.equal((await admin.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'approved')
    assert.deepEqual((await admin.query('SELECT journal_generation,applied_at,applied_transaction_id FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])).rows[0],
      { journal_generation: null, applied_at: null, applied_transaction_id: null })
    const confirmationId = recoveryConfirmationRecordId(operationId)
    await assert.rejects(admin.query('UPDATE public.public_access_pending_decisions SET confirmation_record_id=$1 WHERE operation_id=$2', [confirmationId, operationId]), /must commit before confirmation/)
    const differentConfirmationId = `${confirmationId.slice(0, -1)}${confirmationId.endsWith('0') ? '1' : '0'}`
    await assert.rejects(coordinatorPool.query('SELECT * FROM public.prepare_pending_removal_confirmation($1,$2,$3,$4,$5,$6,$7,$8)',
      ['firebase:demo-idea-map', subject, operationId, input.recordId, '90071992547409931234', body.toString('utf8'), new Date(), differentConfirmationId]),
    /Pending removal is ambiguous/)
    const transaction = await coordinatorPool.connect()
    try {
      await transaction.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await transaction.query('SAVEPOINT synthetic_application')
      const interim = (await transaction.query('SELECT * FROM public.apply_pending_removal($1,$2,$3,$4,$5,$6)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, '90071992547409931234', body.toString('utf8')])).rows[0]
      assert.equal(interim.outcome, 'applied')
      await transaction.query('RELEASE SAVEPOINT synthetic_application')
      await assert.rejects(transaction.query('SELECT * FROM public.prepare_pending_removal_confirmation($1,$2,$3,$4,$5,$6,$7,$8)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, '90071992547409931234', body.toString('utf8'), interim.applied_at, confirmationId]),
      /must commit before confirmation/)
    } finally { await transaction.query('ROLLBACK'); transaction.release() }
    assert.equal((await admin.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'approved')
    const directTransaction = await admin.connect()
    try {
      await directTransaction.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await directTransaction.query('SAVEPOINT synthetic_application')
      await directTransaction.query('SELECT * FROM public.apply_pending_removal($1,$2,$3,$4,$5,$6)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, '90071992547409931234', body.toString('utf8')])
      await directTransaction.query('RELEASE SAVEPOINT synthetic_application')
      await assert.rejects(directTransaction.query('UPDATE public.public_access_pending_decisions SET confirmation_record_id=$1,confirmation_prepared_at=clock_timestamp() WHERE operation_id=$2',
        [confirmationId, operationId]), /must commit before confirmation/)
    } finally { await directTransaction.query('ROLLBACK'); directTransaction.release() }
    const decoded = decodeRecoveryRecord(body, 'dev')
    const forged = Buffer.from(encodeRecoveryIntent({ operationId: decoded.operationId, environment: decoded.environment,
      ideaId: decoded.ideaId, actorId: decoded.actorId, authorizedAt: decoded.authorizedAt,
      decision: { ...decoded.decision, classification: 'violation' } }))
    const forgedChecksum = new CRC32C(); forgedChecksum.update(forged)
    await assert.rejects(execute(verifier, fakeReader(forged, forgedChecksum.toString()), { ...argumentsFor, payload: forged }), /Pending removal unavailable/)
    await assert.rejects(execute(verifier, fakeReader(), { ...argumentsFor, recordId: randomUUID() }), /Pending removal unavailable/)
    const applied = await execute()
    assert.equal(applied.state, 'authorized')
    assert.equal(applied.value.state, 'applied')
    assert.equal(applied.value.recordId, input.recordId)
    assert.equal(applied.value.generation, '90071992547409931234')
    assert.equal(Number.isFinite(Date.parse(applied.value.appliedAt)), true)
    assert.deepEqual(await execute(), applied)
    await assert.rejects(execute(verifier, fakeReader(body, checksum.toString(), '90071992547409931235')), /Pending removal unavailable/)
    assert.equal((await admin.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'withdrawn')
    assert.equal((await admin.query('SELECT published FROM public.media_previews WHERE id=$1', [preview])).rows[0].published, false)
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.moderator_removals WHERE idea_id=$1', [idea])).rows[0].count, 1)
    assert.equal((await admin.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
    assert.match((await admin.query('SELECT applied_transaction_id FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])).rows[0].applied_transaction_id, /^[1-9][0-9]*$/)
    await assert.rejects(admin.query("UPDATE public.public_access_pending_decisions SET applied_transaction_id='1' WHERE operation_id=$1", [operationId]), /application is immutable/)
    const confirmationInput = { ...argumentsFor, generation: applied.value.generation, appliedAt: applied.value.appliedAt }
    const prepareConfirmation = () => prepareRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, 'dev', confirmationInput)
    // Model a pre-migration applied row with no top-level transaction evidence.
    // The trigger override is local to this rolled-back synthetic transaction.
    const legacy = await admin.connect()
    try {
      await legacy.query('BEGIN')
      await legacy.query("SET LOCAL session_replication_role = 'replica'")
      await legacy.query('UPDATE public.public_access_pending_decisions SET applied_transaction_id=NULL WHERE operation_id=$1', [operationId])
      await assert.rejects(legacy.query('SELECT * FROM public.prepare_pending_removal_confirmation($1,$2,$3,$4,$5,$6,$7,$8)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, applied.value.generation, body.toString('utf8'), applied.value.appliedAt, confirmationId]),
      /must commit before confirmation/)
    } finally { await legacy.query('ROLLBACK'); legacy.release() }
    let confirmationChecks = 0
    const revokedConfirmation = { ...verifier, async getUser() { return { uid: subject, email: session.email,
      emailVerified: true, disabled: ++confirmationChecks > 1 } } }
    assert.deepEqual(await prepareRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie',
      revokedConfirmation, 'dev', confirmationInput), { state: 'unauthenticated' })
    assert.deepEqual((await admin.query('SELECT confirmation_record_id,confirmation_prepared_at FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])).rows[0],
      { confirmation_record_id: null, confirmation_prepared_at: null })
    const confirmation = await prepareConfirmation()
    assert.equal(confirmation.state, 'authorized')
    assert.equal(confirmation.value.recordId, confirmationId)
    assert.deepEqual(await prepareConfirmation(), confirmation)
    await assert.rejects(admin.query("UPDATE public.public_access_pending_decisions SET confirmation_prepared_at=confirmation_prepared_at + interval '1 second' WHERE operation_id=$1", [operationId]), /confirmation is immutable/)
    assert.deepEqual(decodeRecoveryRecord(confirmation.value.payload, 'dev'), { version: 1, recordType: 'commit_confirmation',
      operationId, environment: 'dev', confirmedAt: confirmation.value.preparedAt })
    assert.ok(Date.parse(confirmation.value.preparedAt) >= Date.parse(applied.value.appliedAt))
    const writer = (objects, lost) => ({ bucket: () => ({ getMetadata: bucketMetadata, file: name => ({ createWriteStream: options => {
      assert.equal(options.preconditionOpts.ifGenerationMatch, 0)
      const chunks = []
      return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() }, final(callback) {
        if (objects.has(name)) return callback(new Error('synthetic precondition failure'))
        objects.set(name, Buffer.concat(chunks))
        callback(lost ? new Error('synthetic lost response') : undefined)
      } })
    } }) }) })
    const writeConfirmation = (objects, lost) => writeRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      target, writer(objects, lost), confirmationInput)
    const successfulObjects = new Map()
    assert.deepEqual(await writeConfirmation(successfulObjects, false), { state: 'authorized', value: { state: 'confirmation_written', recordId: confirmationId } })
    assert.deepEqual([...successfulObjects.values()], [Buffer.from(confirmation.value.payload)])
    // A second isolated fake models a write whose success response was lost.
    const confirmationObjects = new Map()
    assert.deepEqual(await writeConfirmation(confirmationObjects, true), { state: 'authorized', value: 'confirmation_uncertain' })
    assert.deepEqual(await writeConfirmation(confirmationObjects, false), { state: 'authorized', value: 'confirmation_uncertain' })
    const confirmationPath = `idea-map-v2/dev/recovery-journal/${confirmationId}.json`
    const recoveredBytes = confirmationObjects.get(confirmationPath)
    assert.deepEqual(recoveredBytes, Buffer.from(confirmation.value.payload))
    const confirmationChecksum = new CRC32C(); confirmationChecksum.update(recoveredBytes)
    assert.deepEqual(await compareCurrentRecoveryJournalRecord(fakeReader(recoveredBytes, confirmationChecksum.toString()),
      target, confirmationId, confirmation.value.payload), { generation: '90071992547409931234', coverageVerified: false })
    const storedReader = fakeReader(recoveredBytes, confirmationChecksum.toString())
    const confirmationReader = { bucket(bucket) { return { getMetadata: bucketMetadata, file(name) {
      if (name !== confirmationPath || !confirmationObjects.has(name)) throw new Error('Synthetic confirmation is missing')
      return storedReader.bucket(bucket).file(name)
    } } } }
    const verifyConfirmation = (v = verifier, source = confirmationReader) => verifyRemovalConfirmation(
      coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', v, target, source, confirmationInput)
    await assert.rejects(preparePool.query('SELECT * FROM public.verify_pending_removal_confirmation($1,$2,$3,$4,$5,$6)',
      ['firebase:demo-idea-map', subject, operationId, confirmationId, confirmation.value.preparedAt, '1']), { code: '42501' })
    assert.deepEqual(await verifyConfirmation(verifier, fakeReader(body, checksum.toString())),
      { state: 'authorized', value: 'confirmation_uncertain' })
    assert.deepEqual((await admin.query('SELECT confirmation_generation,confirmation_verified_at FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])).rows[0],
      { confirmation_generation: null, confirmation_verified_at: null })
    let verificationChecks = 0
    const revokedVerification = { ...verifier, async getUser() { return { uid: subject, email: session.email,
      emailVerified: true, disabled: ++verificationChecks > 3 } } }
    assert.deepEqual(await verifyConfirmation(revokedVerification), { state: 'unauthenticated' })
    assert.deepEqual((await admin.query('SELECT confirmation_generation,confirmation_verified_at FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])).rows[0],
      { confirmation_generation: null, confirmation_verified_at: null })
    // Simulate a database commit whose success response is lost. Preparation
    // uses the first transaction; verification commits in the second.
    const runtimePool = pendingRemovalDatabasePool(coordinatorUrl.toString())
    const originalConnect = runtimePool.connect
    let connected = 0
    runtimePool.connect = async function (...args) {
      const client = await originalConnect.apply(this, args)
      if (++connected === 2) {
        const originalQuery = client.query
        client.query = async function (...queryArgs) {
          const value = await originalQuery.apply(this, queryArgs)
          if (queryArgs[0] === 'COMMIT') {
            client.query = originalQuery
            throw new Error('synthetic lost commit response')
          }
          return value
        }
      }
      return client
    }
    try { await assert.rejects(verifyConfirmation(), /Pending removal unavailable/) }
    finally { runtimePool.connect = originalConnect }
    const committed = (await admin.query('SELECT confirmation_generation,confirmation_verified_at FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])).rows[0]
    assert.equal(committed.confirmation_generation, '90071992547409931234')
    assert.ok(committed.confirmation_verified_at instanceof Date)
    assert.equal((await admin.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
    const verified = await verifyConfirmation()
    assert.equal(verified.state, 'authorized')
    assert.equal(verified.value.verifiedAt, committed.confirmation_verified_at.toISOString())
    assert.equal(verified.value.state, 'confirmation_verified')
    assert.equal(verified.value.recordId, confirmationId)
    assert.equal(verified.value.generation, '90071992547409931234')
    assert.ok(Date.parse(verified.value.verifiedAt) >= Date.parse(confirmation.value.preparedAt))
    assert.deepEqual(await verifyConfirmation(), verified)
    await assert.rejects(verifyConfirmation(verifier, fakeReader(recoveredBytes, confirmationChecksum.toString(), '90071992547409931235')),
      /Pending removal unavailable/)
    await assert.rejects(admin.query("UPDATE public.public_access_pending_decisions SET confirmation_generation='9' WHERE operation_id=$1", [operationId]),
      /Confirmation verification is immutable/)
    assert.equal((await admin.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
    staleIdea = (await admin.query("INSERT INTO public.ideas(author_contact_id,publication_state) VALUES ($1,'approved') RETURNING id", [contact])).rows[0].id
    staleRevision = (await admin.query("INSERT INTO public.idea_revisions(idea_id,version,content,review_state) VALUES ($1,1,'{}'::jsonb,'approved') RETURNING id", [staleIdea])).rows[0].id
    await admin.query('INSERT INTO public.approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [staleIdea, staleRevision])
    const staleInput = { ...input, operationId: randomUUID(), recordId: randomUUID(), ideaId: staleIdea, approvedRevisionId: staleRevision }
    staleOperation = staleInput.operationId
    const stalePrepared = await preparePendingRemoval(prepareUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, 'dev', staleInput)
    assert.equal(stalePrepared.state, 'authorized')
    assert.equal(stalePrepared.value.state, 'pending')
    const staleBody = Buffer.from(stalePrepared.value.payload)
    const staleChecksum = new CRC32C(); staleChecksum.update(staleBody)
    await admin.query("UPDATE public.ideas SET publication_state='private' WHERE id=$1", [staleIdea])
    assert.deepEqual(await execute(verifier, fakeReader(staleBody, staleChecksum.toString()),
      { operationId: staleOperation, recordId: staleInput.recordId, payload: staleBody }), { state: 'authorized', value: 'stale' })
    assert.equal((await admin.query('SELECT applied_at FROM public.public_access_pending_decisions WHERE operation_id=$1', [staleOperation])).rows[0].applied_at, null)
    assert.equal((await admin.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
  } finally {
    await reader?.release().catch(() => {})
    if (applying) await applying.catch(() => {})
    await preparePool?.end()
    await coordinatorPool?.end()
    if (prepareUsed) await pendingRemovalDatabasePool(prepareUrl.toString()).end()
    if (coordinatorUsed) await pendingRemovalDatabasePool(coordinatorUrl.toString()).end()
    if (operationId) await admin.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])
    if (staleOperation) await admin.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id=$1', [staleOperation])
    if (idea) {
      await admin.query('DELETE FROM public.moderator_removals WHERE idea_id=$1', [idea])
      await admin.query("DELETE FROM public.outbox WHERE job_id IN (SELECT id FROM public.jobs WHERE idempotency_key=$1)", [`removal:${idea}:${revision}`])
      await admin.query('DELETE FROM public.jobs WHERE idempotency_key=$1', [`removal:${idea}:${revision}`])
      await admin.query('DELETE FROM public.media_previews WHERE idea_id=$1', [idea])
      await admin.query('DELETE FROM public.approved_revisions WHERE idea_id=$1', [idea])
      await admin.query('DELETE FROM public.idea_revisions WHERE idea_id=$1', [idea])
      await admin.query('DELETE FROM public.ideas WHERE id=$1', [idea])
    }
    if (staleIdea) {
      await admin.query('DELETE FROM public.approved_revisions WHERE idea_id=$1', [staleIdea])
      await admin.query('DELETE FROM public.idea_revisions WHERE idea_id=$1', [staleIdea])
      await admin.query('DELETE FROM public.ideas WHERE id=$1', [staleIdea])
    }
    if (contact) await admin.query('DELETE FROM public.contacts WHERE id=$1', [contact])
    // Moderator assignments are immutable. Their synthetic actor and identity
    // remain in this disposable database, as in the other moderation tests.
    await admin.query('UPDATE public.public_access_gate SET is_open=false WHERE singleton=true')
    if (createdRoles.length) {
      await admin.query(`DROP OWNED BY ${createdRoles.map(role => `"${role}"`).join(', ')}`)
      await admin.query(`DROP ROLE ${createdRoles.map(role => `"${role}"`).join(', ')}`)
    }
    await admin.end()
    if (originalEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
    else process.env.STORAGE_EMULATOR_HOST = originalEmulator
  }
})
