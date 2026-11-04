import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'
import { CRC32C } from '@google-cloud/storage'
import { acquirePublicAccessLease, publicAccessLeaseClient } from '../dist/public-access-lease.js'
import { applySequenceJournaledRemoval, inspectSequenceRemoval, inspectSequenceRemovalConfirmation, journalPendingRemovalSequence, journalSequenceRemovalConfirmation, pinPendingRemovalSequence, preparePendingRemoval, prepareRemovalConfirmation, verifySequenceRemovalConfirmation } from '../dist/pending-removal.js'
import { decodeRecoveryRecord, encodeRecoveryIntent, recoveryConfirmationRecordId } from '../dist/recovery-journal-record.js'
import { pendingRemovalDatabasePool, runtimeDatabasePool } from '../dist/runtime-database.js'

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
    // The pending decision and gate commit even while readers still hold their
    // shared locks. They must not require the later exclusive drain to finish.
    const mutableRemoval = { ...input }
    const changingRequest = { ...verifier, async getUser() {
      mutableRemoval.operationId = randomUUID(); mutableRemoval.recordId = randomUUID(); mutableRemoval.ideaId = randomUUID()
      mutableRemoval.approvedRevisionId = randomUUID(); mutableRemoval.classification = 'violation'; mutableRemoval.reason = 'changed synthetic reason'
      return { uid: session.uid, email: session.email, emailVerified: true, disabled: false }
    } }
    const prepared = await preparePendingRemoval(url.toString(), 'demo-idea-map', 'synthetic-cookie', changingRequest, 'dev', mutableRemoval)
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
    const epoch = randomUUID()
    const pinSql = 'SELECT public.pin_pending_removal_sequence($1,$2,$3,$4,$5,$6,$7,$8) AS outcome'
    const pinArgs = ['firebase:demo-idea-map', session.uid, secondOperationId, secondRecordId,
      Buffer.from(limited.value.payload).toString('utf8'), '123456789', 'synthetic-journal', epoch]
    assert.equal((await pool.query("SELECT has_function_privilege('public','public.pin_pending_removal_sequence(text,text,uuid,uuid,text,text,text,uuid)','EXECUTE') AS allowed")).rows[0].allowed, false)
    await assert.rejects(restrictedPool.query(pinSql, pinArgs), { code: '42501' })
    await assert.rejects(pool.query('UPDATE public.public_access_pending_decisions SET journal_project_number=$1 WHERE operation_id=$2',
      ['123456789', secondOperationId]), { code: '23514' })
    await assert.rejects(pool.query(pinSql, [...pinArgs.slice(0, 4), 'synthetic wrong intent', ...pinArgs.slice(5)]), /ambiguous/)
    const sequenceTarget = { environment: 'dev', projectNumber: '123456789', secretId: 'synthetic-journal', epochId: epoch }
    const sequenceInput = { operationId: secondOperationId, recordId: secondRecordId, payload: limited.value.payload }
    let pinChecks = 0
    const revokedDuringPin = { ...verifier, async getUser() { return { uid: session.uid, email: session.email, emailVerified: true, disabled: ++pinChecks > 1 } } }
    assert.deepEqual(await pinPendingRemovalSequence(url.toString(), 'demo-idea-map', 'synthetic-cookie', revokedDuringPin, sequenceTarget, sequenceInput),
      { state: 'unauthenticated' })
    assert.equal((await pool.query('SELECT journal_project_number FROM public.public_access_pending_decisions WHERE operation_id=$1', [secondOperationId])).rows[0].journal_project_number, null)
    assert.deepEqual(await pinPendingRemovalSequence(url.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, sequenceTarget, sequenceInput),
      { state: 'authorized', value: 'pinned' })
    assert.deepEqual(await pinPendingRemovalSequence(url.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, sequenceTarget, sequenceInput),
      { state: 'authorized', value: 'pinned' })
    await assert.rejects(pinPendingRemovalSequence(url.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      { ...sequenceTarget, secretId: 'other-journal' }, sequenceInput), /Pending removal unavailable/)
    const versions = []
    const sequencePath = 'projects/123456789/secrets/synthetic-journal'
    let loseAppend = true
    const writer = { async request(method, path, body) {
      assert.equal(method, 'POST'); assert.equal(path, `${sequencePath}:addVersion`)
      const pin = await pool.query('SELECT journal_secret_id FROM public.public_access_pending_decisions WHERE operation_id=$1', [secondOperationId])
      assert.equal(pin.rows[0].journal_secret_id, 'synthetic-journal') // The pin is visible from another transaction.
      versions.push(Buffer.from(body.payload.data, 'base64'))
      if (loseAppend) { loseAppend = false; throw new Error('synthetic lost response') }
      return { status: 200, data: { name: `${sequencePath}/versions/${versions.length}`, state: 'ENABLED', clientSpecifiedPayloadChecksum: true } }
    } }
    const sequenceReader = { async request(method, path) {
      assert.equal(method, 'GET')
      const version = Number(path.match(/\/versions\/(\d+):access$/)?.[1])
      const bytes = versions[version - 1]
      const crc = new CRC32C(); crc.update(bytes)
      return { status: 200, data: { name: `${sequencePath}/versions/${version}`,
        payload: { data: bytes.toString('base64'), dataCrc32c: String(Buffer.from(crc.toString(), 'base64').readUInt32BE(0)) } } }
    } }
    assert.deepEqual(await journalPendingRemovalSequence(url.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      sequenceTarget, writer, sequenceReader, sequenceInput), { state: 'authorized', value: 'journal_uncertain' })
    const mutableTarget = { ...sequenceTarget }, mutableInput = { ...sequenceInput, payload: Buffer.from(sequenceInput.payload) }
    const mutateDuringVerification = { ...verifier, async getUser() {
      mutableTarget.secretId = 'other-journal'; mutableInput.payload.fill(0); mutableInput.operationId = randomUUID()
      return { uid: session.uid, email: session.email, emailVerified: true, disabled: false }
    } }
    assert.deepEqual(await journalPendingRemovalSequence(url.toString(), 'demo-idea-map', 'synthetic-cookie', mutateDuringVerification,
      mutableTarget, writer, sequenceReader, mutableInput),
    { state: 'authorized', value: { state: 'journaled', version: '2', coverageVerified: false } })
    assert.deepEqual(versions[0], versions[1])
    assert.deepEqual(await journalPendingRemovalSequence(url.toString(), 'demo-idea-map', '', verifier,
      sequenceTarget, writer, sequenceReader, sequenceInput), { state: 'unauthenticated' })
    await assert.rejects(journalPendingRemovalSequence(url.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      { ...sequenceTarget, epochId: randomUUID() }, writer, sequenceReader, sequenceInput), /Pending removal unavailable/)
    assert.equal(versions.length, 2)
    const deniedReader = { async request() { return { status: 403, data: {} } } }
    assert.deepEqual(await journalPendingRemovalSequence(url.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      sequenceTarget, writer, deniedReader, sequenceInput), { state: 'authorized', value: 'journal_uncertain' })
    assert.deepEqual(versions[2], versions[0])
    assert.equal((await pool.query(pinSql, pinArgs)).rows[0].outcome, 'pinned')
    await assert.rejects(pool.query(pinSql, [...pinArgs.slice(0, 6), 'other-journal', pinArgs[7]]), /ambiguous/)
    await assert.rejects(pool.query('UPDATE public.public_access_pending_decisions SET journal_epoch_id=$1 WHERE operation_id=$2',
      [randomUUID(), secondOperationId]), /immutable/)
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate WHERE singleton=true')).rows[0].is_open, false)
    const concurrent = Array.from({ length: 2 }, () => ({ operationId: randomUUID(), recordId: randomUUID() }))
    concurrentOperations.push(...concurrent.map(item => item.operationId))
    const outcomes = await Promise.all(concurrent.map(item => prepare(verifier, item)))
    assert.ok(outcomes.every(result => result.state === 'authorized' && result.value.state === 'pending'))
    const transaction = await pool.connect()
    try {
      await transaction.query('BEGIN')
      await transaction.query(pinSql, ['firebase:demo-idea-map', session.uid, concurrent[0].operationId, concurrent[0].recordId,
        Buffer.from(outcomes[0].value.payload).toString('utf8'), '123456789', 'synthetic-journal', epoch])
      await transaction.query('SAVEPOINT after_pin')
      await assert.rejects(transaction.query('SELECT * FROM public.pending_sequence_removal_status($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['firebase:demo-idea-map', session.uid, concurrent[0].operationId, concurrent[0].recordId,
          Buffer.from(outcomes[0].value.payload).toString('utf8'), 'dev', '123456789', 'synthetic-journal', epoch]), /Pending removal is ambiguous/)
      await transaction.query('ROLLBACK TO SAVEPOINT after_pin')
      await assert.rejects(transaction.query('SELECT * FROM public.apply_pending_sequence_removal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        ['firebase:demo-idea-map', session.uid, concurrent[0].operationId, concurrent[0].recordId, '1',
          Buffer.from(outcomes[0].value.payload).toString('utf8'), 'dev', '123456789', 'synthetic-journal', epoch]), /Pending removal is ambiguous/)
      await transaction.query('ROLLBACK TO SAVEPOINT after_pin')
      await assert.rejects(transaction.query('UPDATE public.public_access_pending_decisions SET journal_generation=$1, applied_at=clock_timestamp() WHERE operation_id=$2',
        ['1', concurrent[0].operationId]), /must commit before application/)
    } finally { await transaction.query('ROLLBACK'); transaction.release() }
    assert.equal((await pool.query('SELECT journal_project_number FROM public.public_access_pending_decisions WHERE operation_id=$1',
      [concurrent[0].operationId])).rows[0].journal_project_number, null)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM public.public_access_pending_decisions')).rows[0].count,
      2 + concurrentOperations.length)
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate')).rows[0].is_open, false)
    const sequenceApply = 'public.apply_pending_sequence_removal(text,text,uuid,uuid,text,text,text,text,text,uuid)'
    assert.equal((await pool.query('SELECT has_function_privilege($1,$2,$3) AS allowed', ['public', sequenceApply, 'EXECUTE'])).rows[0].allowed, false)
    await pool.query(`GRANT EXECUTE ON FUNCTION ${sequenceApply} TO "${role}"`)
    await assert.rejects(restrictedPool.query('SELECT * FROM public.apply_pending_removal($1,$2,$3,$4,$5,$6)',
      ['firebase:demo-idea-map', session.uid, secondOperationId, secondRecordId, '2', Buffer.from(sequenceInput.payload).toString('utf8')]), { code: '42501' })
    const sequenceApplication = { ...sequenceInput, version: '2' }
    const applySequence = (destination = sequenceTarget, source = sequenceReader, value = sequenceApplication) =>
      applySequenceJournaledRemoval(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, destination, source, value)
    assert.deepEqual(await applySequence(sequenceTarget, deniedReader), { state: 'authorized', value: 'journal_uncertain' })
    assert.deepEqual(await applySequence({ ...sequenceTarget, epochId: randomUUID() }), { state: 'authorized', value: 'journal_uncertain' })
    await assert.rejects(restrictedPool.query('SELECT * FROM public.apply_pending_sequence_removal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      ['firebase:demo-idea-map', session.uid, secondOperationId, secondRecordId, '2', Buffer.from(sequenceInput.payload).toString('utf8'),
        'dev', sequenceTarget.projectNumber, sequenceTarget.secretId, randomUUID()]), /Pending removal is ambiguous/)
    assert.equal((await pool.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'approved')
    const appliedSequence = await applySequence()
    assert.equal(appliedSequence.state, 'authorized')
    assert.equal(appliedSequence.value.state, 'applied')
    assert.equal(appliedSequence.value.version, '2')
    assert.deepEqual(await applySequence(), appliedSequence)
    await assert.rejects(applySequence(sequenceTarget, sequenceReader, { ...sequenceApplication, version: '3' }), /Pending removal unavailable/)
    assert.equal((await pool.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'withdrawn')
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate WHERE singleton=true')).rows[0].is_open, false)
    const sequenceVerification = 'public.verify_pending_sequence_confirmation(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)'
    assert.equal((await pool.query('SELECT has_function_privilege($1,$2,$3) AS allowed', ['public', sequenceVerification, 'EXECUTE'])).rows[0].allowed, false)
    await pool.query(`GRANT EXECUTE ON FUNCTION public.pin_pending_removal_sequence(text,text,uuid,uuid,text,text,text,uuid), public.prepare_pending_removal_confirmation(text,text,uuid,uuid,text,text,timestamptz,uuid), public.pending_sequence_confirmation_status(text,text,uuid,uuid,text,text,timestamptz,uuid,timestamptz,text,text,text,uuid), ${sequenceVerification} TO "${role}"`)
    const appliedInput = { ...sequenceInput, generation: appliedSequence.value.version, appliedAt: appliedSequence.value.appliedAt }
    await assert.rejects(journalSequenceRemovalConfirmation(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      { ...sequenceTarget, secretId: 'other-journal' }, writer, sequenceReader, appliedInput), /Pending removal unavailable/)
    assert.equal(versions.length, 3)
    assert.deepEqual(await journalSequenceRemovalConfirmation(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      sequenceTarget, writer, deniedReader, appliedInput), { state: 'authorized', value: 'confirmation_uncertain' })
    const journaledConfirmation = await journalSequenceRemovalConfirmation(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      sequenceTarget, writer, sequenceReader, appliedInput)
    assert.deepEqual(journaledConfirmation, { state: 'authorized', value: { state: 'confirmation_journaled',
      recordId: recoveryConfirmationRecordId(secondOperationId), version: '5', coverageVerified: false } })
    assert.deepEqual(versions[3], versions[4])
    const preparedAt = (await pool.query('SELECT confirmation_prepared_at FROM public.public_access_pending_decisions WHERE operation_id=$1', [secondOperationId])).rows[0].confirmation_prepared_at
    const verifySql = 'SELECT * FROM public.verify_pending_sequence_confirmation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
    const verifyArgs = ['firebase:demo-idea-map', session.uid, secondOperationId, recoveryConfirmationRecordId(secondOperationId), preparedAt,
      '5', 'dev', sequenceTarget.projectNumber, sequenceTarget.secretId, sequenceTarget.epochId]
    await assert.rejects(restrictedPool.query(verifySql, [...verifyArgs.slice(0, 9), randomUUID()]), /Pending removal is ambiguous/)
    await assert.rejects(restrictedPool.query(verifySql, [...verifyArgs.slice(0, 5), '2', ...verifyArgs.slice(6)]), /Pending removal is ambiguous/)
    const verifySequence = (source = sequenceReader, version = '5') => verifySequenceRemovalConfirmation(restrictedUrl.toString(),
      'demo-idea-map', 'synthetic-cookie', verifier, sequenceTarget, source, appliedInput, version)
    assert.deepEqual(await verifySequence(deniedReader), { state: 'authorized', value: 'confirmation_uncertain' })
    assert.deepEqual(await verifySequence(sequenceReader, '2'), { state: 'authorized', value: 'confirmation_uncertain' })
    const verifiedSequence = await verifySequence()
    assert.equal(verifiedSequence.state, 'authorized')
    assert.equal(verifiedSequence.value.state, 'confirmation_verified')
    assert.equal(verifiedSequence.value.version, '5')
    assert.deepEqual(await verifySequence(), verifiedSequence)
    assert.deepEqual(await inspectSequenceRemovalConfirmation(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      sequenceTarget, deniedReader, appliedInput), { state: 'authorized', value: 'confirmation_uncertain' })
    assert.deepEqual(await journalSequenceRemovalConfirmation(restrictedUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      sequenceTarget, writer, sequenceReader, appliedInput), verifiedSequence)
    assert.equal(versions.length, 5)
    await assert.rejects(verifySequence(sequenceReader, '4'), /Pending removal unavailable/)
    assert.equal((await pool.query('SELECT is_open FROM public.public_access_gate WHERE singleton=true')).rows[0].is_open, false)
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
      await pool.query(`REVOKE EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.prepare_pending_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text), public.apply_pending_sequence_removal(text,text,uuid,uuid,text,text,text,text,text,uuid), public.pin_pending_removal_sequence(text,text,uuid,uuid,text,text,text,uuid), public.prepare_pending_removal_confirmation(text,text,uuid,uuid,text,text,timestamptz,uuid), public.pending_sequence_confirmation_status(text,text,uuid,uuid,text,text,timestamptz,uuid,timestamptz,text,text,text,uuid), public.verify_pending_sequence_confirmation(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid) FROM "${role}"`)
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

test('sequence coordinator drains readers and preserves a committed confirmation across uncertain responses', async () => {
  const admin = new pg.Pool({ connectionString: url.toString(), max: 6, connectionTimeoutMillis: 2000 })
  const suffix = randomUUID().replaceAll('-', ''), role = `sequence_coordinator_${suffix}`, subject = `sequence-${suffix}`
  const coordinatorUrl = new URL(url)
  coordinatorUrl.username = role; coordinatorUrl.password = 'synthetic-only'
  const target = { environment: 'dev', projectNumber: '123456789', secretId: 'synthetic-journal', epochId: randomUUID() }
  const parent = `projects/${target.projectNumber}/secrets/${target.secretId}`, versions = []
  let reader, actor, contact, idea, revision, preview, operationId, staleIdea, staleRevision, staleOperation
  let roleCreated = false, runtimeUsed = false, applying
  const writer = { async request(method, path, body) {
    assert.equal(method, 'POST'); assert.equal(path, `${parent}:addVersion`)
    versions.push(Buffer.from(body.payload.data, 'base64'))
    return { status: 200, data: { name: `${parent}/versions/${versions.length}`, state: 'ENABLED', clientSpecifiedPayloadChecksum: true } }
  } }
  const read = { async request(method, path) {
    assert.equal(method, 'GET')
    const match = new RegExp(`^${parent}/versions/([1-9][0-9]*):access$`).exec(path)
    assert.ok(match)
    const bytes = versions[Number(match[1]) - 1]
    if (!bytes) return { status: 404, data: null }
    const crc = new CRC32C(); crc.update(bytes)
    return { status: 200, data: { name: `${parent}/versions/${match[1]}`,
      payload: { data: bytes.toString('base64'), dataCrc32c: String(Buffer.from(crc.toString(), 'base64').readUInt32BE(0)) } } }
  } }
  const denied = { async request() { return { status: 403, data: {} } } }
  try {
    actor = (await admin.query('INSERT INTO public.users DEFAULT VALUES RETURNING id')).rows[0].id
    await admin.query("INSERT INTO public.identities(user_id,provider,subject) VALUES ($1,'firebase:demo-idea-map',$2)", [actor, subject])
    await admin.query("INSERT INTO public.moderator_assignments(user_id,granted_by,grant_reason) VALUES ($1,$1,'synthetic authority')", [actor])
    contact = (await admin.query('INSERT INTO public.contacts(normalized_email) VALUES ($1) RETURNING id', [`${suffix}@example.invalid`])).rows[0].id
    idea = (await admin.query("INSERT INTO public.ideas(author_contact_id,publication_state) VALUES ($1,'approved') RETURNING id", [contact])).rows[0].id
    revision = (await admin.query("INSERT INTO public.idea_revisions(idea_id,version,content,review_state) VALUES ($1,1,'{}'::jsonb,'approved') RETURNING id", [idea])).rows[0].id
    await admin.query('INSERT INTO public.approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [idea, revision])
    preview = (await admin.query("INSERT INTO public.media_previews(idea_id,revision_id,object_name,generation,content_type,published) VALUES ($1,$2,$3,'1','image/png',true) RETURNING id", [idea, revision, `synthetic/${suffix}`])).rows[0].id
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'synthetic-only'`); roleCreated = true
    await admin.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await admin.query(`GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text), public.prepare_pending_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text), public.pin_pending_removal_sequence(text,text,uuid,uuid,text,text,text,uuid), public.apply_pending_sequence_removal(text,text,uuid,uuid,text,text,text,text,text,uuid), public.pending_sequence_removal_status(text,text,uuid,uuid,text,text,text,text,uuid), public.prepare_pending_removal_confirmation(text,text,uuid,uuid,text,text,timestamptz,uuid), public.pending_sequence_confirmation_status(text,text,uuid,uuid,text,text,timestamptz,uuid,timestamptz,text,text,text,uuid), public.verify_pending_sequence_confirmation(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid) TO "${role}"`)
    const session = { uid: subject, email: `${suffix}@example.invalid`, email_verified: true, firebase: { sign_in_provider: 'password' } }
    const verifier = { async verifySessionCookie() { return session }, async getUser() { return { uid: subject, email: session.email, emailVerified: true, disabled: false } } }
    const input = { operationId: randomUUID(), recordId: randomUUID(), ideaId: idea, approvedRevisionId: revision,
      classification: 'other', reason: 'synthetic private reason' }
    operationId = input.operationId
    await admin.query('UPDATE public.public_access_gate SET is_open=true WHERE singleton=true')
    reader = await acquirePublicAccessLease(admin)
    runtimeUsed = true
    const prepared = await preparePendingRemoval(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, 'dev', input)
    assert.equal(prepared.state, 'authorized'); assert.equal(prepared.value.state, 'pending')
    await waitForAborts(reader.signal)
    const saved = { operationId, recordId: input.recordId, payload: prepared.value.payload }
    const journaled = await journalPendingRemovalSequence(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, target, writer, read, saved)
    assert.deepEqual(journaled, { state: 'authorized', value: { state: 'journaled', version: '1', coverageVerified: false } })
    const inspect = (source = read, destination = target) => inspectSequenceRemoval(coordinatorUrl.toString(),
      'demo-idea-map', 'synthetic-cookie', verifier, destination, source, saved)
    assert.deepEqual(await inspect(denied), { state: 'authorized', value: 'pending' })
    await assert.rejects(inspect(read, { ...target, epochId: randomUUID() }), /Pending removal unavailable/)
    assert.equal((await admin.query("SELECT has_function_privilege('public','public.pending_sequence_removal_status(text,text,uuid,uuid,text,text,text,text,uuid)','EXECUTE') AS allowed")).rows[0].allowed, false)
    const limited = new pg.Pool({ connectionString: coordinatorUrl.toString() })
    try {
      await assert.rejects(limited.query('SELECT public.remove_published_idea($1,$2,$3,$4,$5,$6)',
        ['firebase:demo-idea-map', subject, idea, revision, 'other', 'synthetic']), { code: '42501' })
      await assert.rejects(limited.query('SELECT * FROM public.apply_pending_removal($1,$2,$3,$4,$5,$6)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, '1', Buffer.from(saved.payload).toString('utf8')]), { code: '42501' })
    } finally { await limited.end() }
    const application = { ...saved, version: '1' }
    const execute = (v = verifier, source = read) => applySequenceJournaledRemoval(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', v, target, source, application)
    assert.deepEqual(await execute(verifier, denied), { state: 'authorized', value: 'journal_uncertain' })
    let checks = 0
    const revoked = { ...verifier, async getUser() { return { uid: subject, email: session.email, emailVerified: true, disabled: ++checks > 1 } } }
    applying = execute(revoked); applying.catch(() => {})
    let waiting = false
    for (let attempt = 0; attempt < 100; attempt++) {
      waiting = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted) AS waiting")).rows[0].waiting
      if (waiting) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(waiting, true)
    await assert.rejects(reader.release(), /Public access unavailable/); reader = undefined
    assert.deepEqual(await applying, { state: 'unauthenticated' }); applying = undefined
    assert.equal((await admin.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'approved')
    const transaction = await admin.connect()
    try {
      await transaction.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await transaction.query('SAVEPOINT synthetic_application')
      const interim = (await transaction.query('SELECT * FROM public.apply_pending_sequence_removal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, '1', Buffer.from(saved.payload).toString('utf8'),
          'dev', target.projectNumber, target.secretId, target.epochId])).rows[0]
      assert.equal(interim.outcome, 'applied')
      await transaction.query('RELEASE SAVEPOINT synthetic_application')
      await transaction.query('SAVEPOINT after_application')
      await assert.rejects(transaction.query('SELECT * FROM public.pending_sequence_removal_status($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, Buffer.from(saved.payload).toString('utf8'),
          'dev', target.projectNumber, target.secretId, target.epochId]), /Pending removal is ambiguous/)
      await transaction.query('ROLLBACK TO SAVEPOINT after_application')
      await assert.rejects(transaction.query('SELECT * FROM public.prepare_pending_removal_confirmation($1,$2,$3,$4,$5,$6,$7,$8)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, '1', Buffer.from(saved.payload).toString('utf8'),
          interim.applied_at, recoveryConfirmationRecordId(operationId)]), /must commit before confirmation/)
    } finally { await transaction.query('ROLLBACK'); transaction.release() }
    const applicationPool = pendingRemovalDatabasePool(coordinatorUrl.toString()), applicationConnect = applicationPool.connect
    applicationPool.connect = async function (...args) {
      const client = await applicationConnect.apply(this, args), originalQuery = client.query
      client.query = async function (...queryArgs) {
        const value = await originalQuery.apply(this, queryArgs)
        if (queryArgs[0] === 'COMMIT') { client.query = originalQuery; throw new Error('synthetic lost application response') }
        return value
      }
      return client
    }
    try { await assert.rejects(execute(), /Pending removal unavailable/) } finally { applicationPool.connect = applicationConnect }
    assert.deepEqual(await inspect(denied), { state: 'authorized', value: 'journal_uncertain' })
    const applied = await inspect()
    assert.equal(applied.state, 'authorized'); assert.equal(applied.value.state, 'applied')
    assert.equal(applied.value.version, '1'); assert.equal(versions.length, 1)
    assert.deepEqual(await journalPendingRemovalSequence(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      target, writer, read, saved), applied)
    assert.equal(versions.length, 1)
    assert.deepEqual(await execute(), applied)
    assert.equal((await admin.query('SELECT publication_state FROM public.ideas WHERE id=$1', [idea])).rows[0].publication_state, 'withdrawn')
    assert.equal((await admin.query('SELECT published FROM public.media_previews WHERE id=$1', [preview])).rows[0].published, false)
    const confirmationInput = { ...saved, generation: '1', appliedAt: applied.value.appliedAt }
    const confirmationId = recoveryConfirmationRecordId(operationId)
    const confirmation = await prepareRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, 'dev', confirmationInput)
    assert.equal(confirmation.state, 'authorized'); assert.equal(confirmation.value.recordId, confirmationId)
    assert.deepEqual(await journalSequenceRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, target, writer, denied, confirmationInput),
      { state: 'authorized', value: 'confirmation_uncertain' })
    const journaledConfirmation = await journalSequenceRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, target, writer, read, confirmationInput)
    assert.deepEqual(journaledConfirmation, { state: 'authorized', value: { state: 'confirmation_journaled', recordId: confirmationId, version: '3', coverageVerified: false } })
    assert.deepEqual(versions[1], versions[2])
    const verifyTransaction = await admin.connect()
    try {
      await verifyTransaction.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      await verifyTransaction.query('SAVEPOINT synthetic_verification')
      await verifyTransaction.query('SELECT * FROM public.verify_pending_sequence_confirmation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        ['firebase:demo-idea-map', subject, operationId, confirmationId, confirmation.value.preparedAt, '3',
          'dev', target.projectNumber, target.secretId, target.epochId])
      await verifyTransaction.query('RELEASE SAVEPOINT synthetic_verification')
      await assert.rejects(verifyTransaction.query('SELECT * FROM public.pending_sequence_confirmation_status($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, Buffer.from(saved.payload).toString('utf8'), '1', applied.value.appliedAt,
          confirmationId, confirmation.value.preparedAt, 'dev', target.projectNumber, target.secretId, target.epochId]), /Pending removal is ambiguous/)
    } finally { await verifyTransaction.query('ROLLBACK'); verifyTransaction.release() }
    const verify = () => verifySequenceRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, target, read, confirmationInput, '3')
    const runtimePool = pendingRemovalDatabasePool(coordinatorUrl.toString()), originalConnect = runtimePool.connect
    let connected = 0
    runtimePool.connect = async function (...args) {
      const client = await originalConnect.apply(this, args)
      if (++connected === 2) {
        const originalQuery = client.query
        client.query = async function (...queryArgs) {
          const value = await originalQuery.apply(this, queryArgs)
          if (queryArgs[0] === 'COMMIT') { client.query = originalQuery; throw new Error('synthetic lost commit response') }
          return value
        }
      }
      return client
    }
    try { await assert.rejects(verify(), /Pending removal unavailable/) } finally { runtimePool.connect = originalConnect }
    const committed = (await admin.query('SELECT confirmation_generation,confirmation_verified_at FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])).rows[0]
    assert.equal(committed.confirmation_generation, '3')
    const verified = await inspectSequenceRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, target, read, confirmationInput)
    assert.equal(verified.state, 'authorized'); assert.equal(verified.value.state, 'confirmation_verified')
    assert.equal(verified.value.verifiedAt, committed.confirmation_verified_at.toISOString())
    assert.deepEqual(await verify(), verified)
    await assert.rejects(admin.query("UPDATE public.public_access_pending_decisions SET confirmation_verified_transaction_id='1' WHERE operation_id=$1", [operationId]), /immutable/)
    const legacy = await admin.connect()
    try {
      await legacy.query('BEGIN')
      await legacy.query("SET LOCAL session_replication_role = 'replica'")
      await legacy.query('UPDATE public.public_access_pending_decisions SET confirmation_verified_transaction_id=NULL WHERE operation_id=$1', [operationId])
      await assert.rejects(legacy.query('SELECT * FROM public.pending_sequence_confirmation_status($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        ['firebase:demo-idea-map', subject, operationId, input.recordId, Buffer.from(saved.payload).toString('utf8'), '1', applied.value.appliedAt,
          confirmationId, confirmation.value.preparedAt, 'dev', target.projectNumber, target.secretId, target.epochId]), /Pending removal is ambiguous/)
    } finally { await legacy.query('ROLLBACK'); legacy.release() }
    assert.deepEqual(await journalSequenceRemovalConfirmation(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      target, writer, read, confirmationInput), verified)
    assert.equal(versions.length, 3)
    staleIdea = (await admin.query("INSERT INTO public.ideas(author_contact_id,publication_state) VALUES ($1,'approved') RETURNING id", [contact])).rows[0].id
    staleRevision = (await admin.query("INSERT INTO public.idea_revisions(idea_id,version,content,review_state) VALUES ($1,1,'{}'::jsonb,'approved') RETURNING id", [staleIdea])).rows[0].id
    await admin.query('INSERT INTO public.approved_revisions(idea_id,revision_id) VALUES ($1,$2)', [staleIdea, staleRevision])
    const staleInput = { ...input, operationId: randomUUID(), recordId: randomUUID(), ideaId: staleIdea, approvedRevisionId: staleRevision }
    staleOperation = staleInput.operationId
    const stalePrepared = await preparePendingRemoval(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, 'dev', staleInput)
    assert.equal(stalePrepared.state, 'authorized'); assert.equal(stalePrepared.value.state, 'pending')
    const staleSaved = { operationId: staleOperation, recordId: staleInput.recordId, payload: stalePrepared.value.payload }
    const staleJournaled = await journalPendingRemovalSequence(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier, target, writer, read, staleSaved)
    assert.equal(staleJournaled.state, 'authorized'); assert.equal(staleJournaled.value.state, 'journaled')
    await admin.query("UPDATE public.ideas SET publication_state='private' WHERE id=$1", [staleIdea])
    assert.deepEqual(await applySequenceJournaledRemoval(coordinatorUrl.toString(), 'demo-idea-map', 'synthetic-cookie', verifier,
      target, read, { ...staleSaved, version: staleJournaled.value.version }), { state: 'authorized', value: 'stale' })
    assert.equal((await admin.query('SELECT applied_at FROM public.public_access_pending_decisions WHERE operation_id=$1', [staleOperation])).rows[0].applied_at, null)
    assert.equal((await admin.query('SELECT is_open FROM public.public_access_gate WHERE singleton=true')).rows[0].is_open, false)
  } finally {
    await reader?.release().catch(() => {})
    if (applying) await applying.catch(() => {})
    if (runtimeUsed) await pendingRemovalDatabasePool(coordinatorUrl.toString()).end()
    if (operationId) await admin.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id=$1', [operationId])
    if (staleOperation) await admin.query('DELETE FROM public.public_access_pending_decisions WHERE operation_id=$1', [staleOperation])
    if (idea) {
      await admin.query('DELETE FROM public.moderator_removals WHERE idea_id=$1', [idea])
      await admin.query('DELETE FROM public.outbox WHERE job_id IN (SELECT id FROM public.jobs WHERE idempotency_key=$1)', [`removal:${idea}:${revision}`])
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
    await admin.query('UPDATE public.public_access_gate SET is_open=false WHERE singleton=true')
    if (roleCreated) { await admin.query(`DROP OWNED BY "${role}"`); await admin.query(`DROP ROLE "${role}"`) }
    await admin.end()
  }
})
