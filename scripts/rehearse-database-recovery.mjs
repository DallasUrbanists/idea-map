import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { createRequire } from 'node:module'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { dumpArguments, exportEncryptedBackup } from '../apps/worker/ops/export-encrypted-backup.mjs'
import { decodeRecoveryRecord, encodeRecoveryConfirmation, encodeRecoveryHoldManifestConfirmation, encodeRecoveryIntent, recoveryConfirmationRecordId } from '../packages/server/dist/recovery-journal-record.js'
import { compareUnverifiedRecoveryCheckpoint } from '../packages/server/dist/recovery-journal-plan.js'
import { encodeUnverifiedHeldManifest } from '../packages/server/dist/recovery-held-manifest.js'
import { verifyUnverifiedHeldCapture } from '../packages/server/dist/recovery-held-verification.js'
import { prepareUnverifiedRecoveryInventory } from '../packages/server/dist/recovery-inventory.js'
import { suppressKnownRemovalsFromJournal, suppressUnverifiedRestoredRemovals } from '../packages/server/dist/recovery-suppression.js'
import { listUnverifiedRecoveryJournal, writeRecoveryJournalRecord, writeUnverifiedHeldMaterial } from '../packages/server/dist/recovery-journal-storage.js'
import { acquirePublicAccessLease } from '../packages/server/dist/public-access-lease.js'
import { readPublishedIdea } from '../packages/server/dist/published-ideas.js'
import { readMediaPreview } from '../packages/server/dist/media-preview.js'

const { CRC32C } = createRequire(new URL('../packages/server/package.json', import.meta.url))('@google-cloud/storage')
const pg = createRequire(new URL('../packages/server/package.json', import.meta.url))('pg')

// The rehearsal owns every target it creates. It has no database or bucket inputs.
const id = randomUUID()
const container = `idea-map-recovery-${id}`
const source = 'idea_map_test_recovery_source'
const target = 'idea_map_test_recovery_target'
const unpreparedTarget = 'idea_map_test_recovery_unprepared'
const missingGateTarget = 'idea_map_test_recovery_missing_gate'
const marker = `synthetic-${id}`
const director = randomUUID()
const reader = `recovery_reader_${id.replaceAll('-', '')}`
const runtime = `recovery_runtime_${id.replaceAll('-', '')}`
const scratchRoot = await realpath(tmpdir())
const scratch = await mkdtemp(join(scratchRoot, 'idea-map-recovery-'))
const archive = join(scratch, 'synthetic.pgdump')
const missingGateArchive = join(scratch, 'synthetic-missing-gate.pgdump')
let created = false

function start(command, args, options = {}) {
  const child = spawn(command, args, { ...options, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)))
  })
  child.stderr.resume()
  return { child, done }
}

async function run(command, args, input, options) {
  const { child, done } = start(command, args, options)
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  child.stdin.end(input)
  await done
  return output.trim()
}

const docker = (...args) => run('docker', args)
const sql = (database, command) => docker('exec', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'idea_map', '-d', database, '-c', command)
async function assertRuntimeFence(database, port) {
  const client = new pg.Client({ connectionString: `postgres://${runtime}:synthetic-runtime-only@127.0.0.1:${port}/${database}`,
    connectionTimeoutMillis: 5000 })
  let rejected = false
  try { await client.connect() } catch (error) { rejected = error.code === '42501' }
  finally { await client.end().catch(() => {}) }
  if (!rejected) throw new Error('Synthetic database fence did not reject runtime access')
}

try {
  await docker('create', '--name', container, '--label', `idea-map.recovery-test=${id}`,
    '-e', 'POSTGRES_USER=idea_map', '-e', 'POSTGRES_PASSWORD=synthetic-local-only',
    '-e', `POSTGRES_DB=${source}`, '-p', '127.0.0.1::5432', 'postgis/postgis@sha256:4a43e3c3e5d55b9208240fc71db543b79c638766280c625a425bd0a2390989c4')
  created = true
  await docker('start', container)
  let ready = false
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    try {
      const logs = await docker('logs', container)
      if (!logs.includes('PostgreSQL init process complete')) throw new Error('Initialization is still running')
      await docker('exec', container, 'pg_isready', '-U', 'idea_map', '-d', source)
      ready = true
    } catch { await delay(1000) }
  }
  if (!ready) throw new Error('Synthetic database did not start')
  const address = await docker('port', container, '5432/tcp')
  const port = /^127\.0\.0\.1:(\d+)$/.exec(address)?.[1]
  if (!port) throw new Error('Synthetic database did not bind loopback')
  const databaseUrl = `postgres://idea_map:synthetic-local-only@127.0.0.1:${port}/${source}`
  const packageManager = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const migrateArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm --filter @idea-map/server db:migrate']
    : ['--filter', '@idea-map/server', 'db:migrate']
  await run(packageManager, migrateArgs, undefined, { env: { ...process.env, DATABASE_URL: databaseUrl } })
  await sql(source, `CREATE TABLE synthetic_recovery_marker (id text PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()); INSERT INTO synthetic_recovery_marker(id) VALUES ('${marker}-before'); INSERT INTO contacts(normalized_email) VALUES ('${marker}@example.invalid'); INSERT INTO ideas(author_contact_id,publication_state) SELECT id,'approved' FROM contacts WHERE normalized_email='${marker}@example.invalid'`)
  await sql(source, `INSERT INTO idea_revisions(idea_id,version,content,review_state) SELECT i.id,1,'{"title":"Synthetic title","description":"Synthetic description"}'::jsonb,'approved' FROM ideas i JOIN contacts c ON c.id=i.author_contact_id WHERE c.normalized_email='${marker}@example.invalid'; INSERT INTO approved_revisions(idea_id,revision_id) SELECT r.idea_id,r.id FROM idea_revisions r JOIN ideas i ON i.id=r.idea_id JOIN contacts c ON c.id=i.author_contact_id WHERE c.normalized_email='${marker}@example.invalid'`)
  const ideaId = await sql(source, `SELECT i.id FROM ideas i JOIN contacts c ON c.id=i.author_contact_id WHERE c.normalized_email='${marker}@example.invalid'`)
  const revisionId = await sql(source, `SELECT r.id FROM idea_revisions r WHERE r.idea_id='${ideaId}'`)
  const previewId = await sql(source, `INSERT INTO media_previews(idea_id,revision_id,object_name,generation,content_type,published) VALUES ('${ideaId}','${revisionId}','synthetic-preview','1','image/png',true) RETURNING id`)
  await sql(source, `CREATE ROLE ${reader} NOLOGIN; CREATE ROLE ${runtime} LOGIN PASSWORD 'synthetic-runtime-only'; GRANT EXECUTE ON FUNCTION public.place_legal_hold_outcome(text,text,uuid,text,text) TO ${reader}; UPDATE public_access_gate SET is_open=true WHERE singleton=true`)
  const captured = await sql(source, `SELECT extract(epoch FROM recorded_at) * 1000 FROM synthetic_recovery_marker WHERE id='${marker}-before'`)
  const dumpStarted = Date.now()
  const storage = { bucket: () => ({ async getMetadata() { return [{ name: 'synthetic-private-backups', projectNumber: '123456789',
    iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
    versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }] },
  file(name) {
    if (name.endsWith('.complete')) return { async save(content, options) {
      if (content !== '' || options.preconditionOpts.ifGenerationMatch !== 0 || options.metadata.metadata.daily_generation !== '123') throw new Error('Synthetic completion record is invalid')
    } }
    const file = { createWriteStream(options) {
    if (options.preconditionOpts.ifGenerationMatch !== 0 || options.validation !== 'crc32c') throw new Error('Synthetic upload safeguards missing')
    const stream = createWriteStream(archive, { flags: 'wx', mode: 0o600 })
    stream.once('finish', () => { file.metadata = { name, generation: '123', metageneration: '1', size: String(stream.bytesWritten), crc32c: 'AAAAAA==' } })
    return stream
  } }
    return file
  } }) }
  const startSyntheticDump = childEnv => {
    if (childEnv.PGDATABASE !== databaseUrl) throw new Error('Unexpected synthetic source')
    const process = start('docker', ['exec', container, 'pg_dump', '-U', 'idea_map', ...dumpArguments, source])
    process.child.stdin.end()
    return process
  }
  await exportEncryptedBackup({ environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789', databaseUrl },
    { start: startSyntheticDump, storage, now: new Date('2026-11-03T00:00:00Z') })
  const backupFinished = Date.now()
  // Model the missing-gate condition of an older archive. This is not a full
  // historical schema or evidence of compatibility with any specific version.
  const missingGateDump = start('docker', ['exec', container, 'pg_dump', '-U', 'idea_map', ...dumpArguments,
    '--exclude-table=public.public_access_gate', source])
  missingGateDump.child.stdin.end()
  await Promise.all([pipeline(missingGateDump.child.stdout, createWriteStream(missingGateArchive, { flags: 'wx', mode: 0o600 })), missingGateDump.done])
  await sql(source, `INSERT INTO synthetic_recovery_marker(id) VALUES ('${marker}-after'); INSERT INTO idea_revisions(idea_id,version,content) VALUES ('${ideaId}',2,'{"title":"Synthetic later held material"}'::jsonb); INSERT INTO users(id) VALUES ('${director}'); INSERT INTO identities(user_id,provider,subject) VALUES ('${director}','firebase:demo-idea-map','${marker}'); INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ('${director}','${director}','synthetic grant'); INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ('${director}','executive_director','synthetic authority','${director}')`)
  const journalTarget = { environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789' }
  const entries = new Map()
  const journal = { bucket: bucket => {
    if (bucket !== journalTarget.bucket) throw new Error('Unexpected synthetic journal bucket')
    return { async getMetadata() { return [{ name: bucket, projectNumber: journalTarget.projectNumber, generation: '100', metageneration: '1',
      iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
      versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }] },
    async getFiles(query) {
      if (query.prefix !== 'idea-map-v2/dev/recovery-journal/' || query.autoPaginate !== false ||
          (query.pageToken !== undefined && query.pageToken !== 'second')) throw new Error('Unexpected synthetic journal inventory')
      if (query.softDeleted === true && query.versions === undefined && query.pageToken === undefined) return [[], null]
      if (query.versions !== true || query.softDeleted !== undefined) throw new Error('Unexpected synthetic journal inventory')
      const objects = [...entries.values()].filter(entry => entry.metadata.name.startsWith(query.prefix))
        .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
      return query.pageToken ? [objects.slice(2), null] : [objects.slice(0, 2), objects.length > 2 ? { pageToken: 'second' } : null]
    }, file(name) {
      const file = { interceptors: [], createWriteStream(options) {
        if (options.preconditionOpts.ifGenerationMatch !== 0 || options.validation !== 'crc32c') throw new Error('Synthetic journal safeguards missing')
        const chunks = []
        return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
          final(callback) {
            if (entries.has(name)) return callback(new Error('Synthetic journal already exists'))
            const body = Buffer.concat(chunks)
            const checksum = new CRC32C()
            checksum.update(body)
            file.metadata = { name, bucket, generation: String(90071992547409931234n + BigInt(entries.size)),
              metageneration: '1', size: String(body.length), contentType: options.metadata?.contentType ?? 'application/json', crc32c: checksum.toString() }
            entries.set(name, { body, metadata: file.metadata })
            callback()
          } })
      }, createReadStream(options) {
        const entry = entries.get(name)
        const request = file.interceptors[0]?.request({ uri: '/synthetic', qs: {} })
        if (!entry || options.validation !== 'crc32c' || options.decompress !== false ||
            request?.qs?.generation !== entry.metadata.generation || request.qs.ifGenerationMatch !== entry.metadata.generation) {
          throw new Error('Unexpected synthetic journal read')
        }
        const checksum = new CRC32C()
        checksum.update(entry.body)
        if (!checksum.validate(entry.metadata.crc32c)) throw new Error('Synthetic journal checksum mismatch')
        const stream = Readable.from([entry.body])
        process.nextTick(() => stream.emit('response', { toJSON: () => ({ headers: {
          'x-goog-stored-content-encoding': 'identity', 'x-goog-hash': `crc32c=${entry.metadata.crc32c}`,
        } }) }))
        return stream
      } }
      return file
    } }
  } }
  const removalOperation = randomUUID()
  const holdOperation = randomUUID()
  const heldArtifact = randomUUID()
  const manifestArtifact = randomUUID()
  let committedHoldId
  let committedAuthorityId
  let committedPlacedAt
  let committedAuthority
  let syntheticCheckpoint
  let heldReference
  let manifestReference
  const authorizedAt = new Date().toISOString()
  const base = { environment: 'dev', ideaId, actorId: director, authorizedAt }
  const previousEmulator = process.env.STORAGE_EMULATOR_HOST
  delete process.env.STORAGE_EMULATOR_HOST
  try {
    await writeRecoveryJournalRecord(journal, journalTarget, randomUUID(), encodeRecoveryIntent({ ...base, operationId: removalOperation,
      decision: { kind: 'removal', classification: 'other', reason: 'synthetic removal' } }))
    await writeRecoveryJournalRecord(journal, journalTarget, randomUUID(), encodeRecoveryIntent({ ...base, operationId: holdOperation,
      decision: { kind: 'hold_placement', caseReference: 'synthetic case', reason: 'synthetic preservation',
        authorizationReference: 'synthetic authority', scope: 'synthetic idea' } }))
    // This fixture checkpoint is not an independent production trust anchor.
    syntheticCheckpoint = (await listUnverifiedRecoveryJournal(journal, journalTarget)).references
    const removed = await sql(source, `SELECT public.remove_published_idea('firebase:demo-idea-map','${marker}','${ideaId}','${revisionId}','other','synthetic removal')`)
    if (removed !== 'removed') throw new Error('Synthetic removal failed')
    const holdOutcome = await sql(source, `SELECT public.place_legal_hold_outcome('firebase:demo-idea-map','${marker}','${ideaId}','synthetic case','synthetic preservation')`)
    if (holdOutcome !== 'processed') throw new Error('Synthetic legal hold failed')
    committedHoldId = await sql(source, `SELECT id FROM legal_holds WHERE idea_id='${ideaId}' AND case_reference='synthetic case' AND released_at IS NULL`)
    if (!/^[0-9a-f-]{36}$/.test(committedHoldId)) throw new Error('Synthetic hold identity is ambiguous')
    committedAuthorityId = await sql(source, `SELECT placement_authority_id FROM legal_holds WHERE id='${committedHoldId}'`)
    committedPlacedAt = await sql(source, `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM legal_holds WHERE id='${committedHoldId}'`)
    committedAuthority = JSON.parse(await sql(source, `SELECT json_build_object('actorId', user_id, 'authority', authority,
      'grantedBy', granted_by, 'grantedAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'authorizationReference', authorization_reference)::text FROM legal_hold_assignments WHERE id='${committedAuthorityId}'`))
    const confirmedAt = await sql(source, `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
    await writeRecoveryJournalRecord(journal, journalTarget, recoveryConfirmationRecordId(removalOperation), encodeRecoveryConfirmation(removalOperation, 'dev', confirmedAt))
    const heldTitle = await sql(source, `SELECT content->>'title' FROM idea_revisions WHERE idea_id='${ideaId}' AND version=2`)
    if (heldTitle !== 'Synthetic later held material') throw new Error('Synthetic held revision is ambiguous')
    const heldRevision = await sql(source, `SELECT id FROM idea_revisions WHERE idea_id='${ideaId}' AND version=2`)
    heldReference = await writeUnverifiedHeldMaterial(journal, journalTarget, heldArtifact, Buffer.from(heldTitle))
    const manifest = encodeUnverifiedHeldManifest({ environment: 'dev', operationId: holdOperation, ideaId, holdId: committedHoldId,
      entries: [{ kind: 'revision', sourceId: heldRevision, sourceGeneration: null, artifactId: heldArtifact,
        generation: heldReference.generation, size: heldReference.size, sha256: heldReference.sha256 }] })
    manifestReference = await writeUnverifiedHeldMaterial(journal, journalTarget, manifestArtifact, manifest)
    const manifestConfirmedAt = await sql(source, `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
    await writeRecoveryJournalRecord(journal, journalTarget, recoveryConfirmationRecordId(holdOperation),
      encodeRecoveryHoldManifestConfirmation(holdOperation, 'dev', manifestConfirmedAt, committedHoldId, committedAuthorityId,
        committedPlacedAt, committedAuthority, { artifactId: manifestArtifact, generation: manifestReference.generation,
          size: manifestReference.size, sha256: manifestReference.sha256 }))
  } finally {
    if (previousEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
    else process.env.STORAGE_EMULATOR_HOST = previousEmulator
  }
  const latest = await sql(source, `SELECT extract(epoch FROM recorded_at) * 1000 FROM synthetic_recovery_marker WHERE id='${marker}-after'`)
  const namedPrivilege = `SELECT has_function_privilege('${reader}','public.place_legal_hold_outcome(text,text,uuid,text,text)','EXECUTE')`
  const sourceNamedExecute = await sql(source, namedPrivilege)
  await sql(source, `REVOKE EXECUTE ON FUNCTION public.place_legal_hold_outcome(text,text,uuid,text,text) FROM ${reader}; DROP ROLE ${reader}`)
  const recoveryStarted = Date.now()
  await docker('exec', container, 'createdb', '-U', 'idea_map', '-T', 'template0', unpreparedTarget)
  await sql(source, `REVOKE CONNECT ON DATABASE ${unpreparedTarget} FROM PUBLIC`)
  const unprepared = start('docker', ['exec', '-i', container, 'pg_restore', '-U', 'idea_map', '--no-owner', '--exit-on-error', '-d', unpreparedTarget])
  let unpreparedError = ''
  unprepared.child.stderr.on('data', chunk => { unpreparedError += chunk })
  unprepared.child.stdout.resume()
  const unpreparedResults = await Promise.allSettled([pipeline(createReadStream(archive), unprepared.child.stdin), unprepared.done])
  if (unpreparedResults[1].status !== 'rejected' || !unpreparedError.includes(`role \"${reader}\" does not exist`)) throw new Error('Missing synthetic role did not stop the restore')
  await sql(source, `CREATE ROLE ${reader} NOLOGIN`)
  await docker('exec', container, 'createdb', '-U', 'idea_map', '-T', 'template0', missingGateTarget)
  await sql(source, `REVOKE CONNECT ON DATABASE ${missingGateTarget} FROM PUBLIC`)
  const missingGateRestore = start('docker', ['exec', '-i', container, 'pg_restore', '-U', 'idea_map', '--no-owner', '--exit-on-error', '-d', missingGateTarget])
  missingGateRestore.child.stdout.resume()
  await Promise.all([pipeline(createReadStream(missingGateArchive), missingGateRestore.child.stdin), missingGateRestore.done])
  if (await sql(missingGateTarget, "SELECT to_regclass('public.public_access_gate') IS NULL") !== 't') throw new Error('Synthetic gate was not omitted')
  await assertRuntimeFence(missingGateTarget, port)
  const missingGatePool = new pg.Pool({ connectionString: `postgres://idea_map:synthetic-local-only@127.0.0.1:${port}/${missingGateTarget}`,
    max: 1, connectionTimeoutMillis: 5000 })
  try {
    let lease
    try { lease = await acquirePublicAccessLease(missingGatePool) }
    catch (error) { if (error.message !== 'Public access unavailable') throw error }
    if (lease) { await lease.release(); throw new Error('A missing gate allowed a synthetic public lease') }
  } finally { await missingGatePool.end() }
  await docker('exec', container, 'createdb', '-U', 'idea_map', '-T', 'template0', target)
  await sql(source, `REVOKE CONNECT ON DATABASE ${target} FROM PUBLIC`)
  const restore = start('docker', ['exec', '-i', container, 'pg_restore', '-U', 'idea_map', '--no-owner', '--exit-on-error', '-d', target])
  restore.child.stdout.resume()
  await Promise.all([pipeline(createReadStream(archive), restore.child.stdin), restore.done])
  // An older archive can contain an open gate. The replacement is independently
  // isolated before restore, so a runtime identity cannot connect at this point.
  const originallyOpenGate = await sql(target, 'SELECT is_open FROM public.public_access_gate WHERE singleton=true')
  if (originallyOpenGate !== 't') throw new Error('Synthetic archive did not contain an open gate')
  await assertRuntimeFence(target, port)
  // Keep the database gate closed for all subsequent reconciliation. The
  // external fence remains in place and is still required for older schemas.
  const closedGate = await sql(target, 'UPDATE public.public_access_gate SET is_open=false WHERE singleton=true RETURNING is_open')
  if (closedGate !== 'f') throw new Error('Synthetic gate could not be closed')
  const restored = await sql(target, `SELECT count(*) FROM synthetic_recovery_marker WHERE id='${marker}-before'`)
  const excluded = await sql(target, `SELECT count(*) FROM synthetic_recovery_marker WHERE id='${marker}-after'`)
  const postgis = await sql(target, 'SELECT count(*) FROM pg_extension WHERE extname = \'postgis\'')
  const migrations = await sql(target, 'SELECT count(*) FROM drizzle.__drizzle_migrations')
  const ideas = await sql(target, `SELECT count(*) FROM ideas i JOIN contacts c ON c.id=i.author_contact_id WHERE c.normalized_email='${marker}@example.invalid'`)
  const visibleQuery = `SELECT count(*) FROM ideas i JOIN contacts c ON c.id=i.author_contact_id JOIN approved_revisions a ON a.idea_id=i.id JOIN idea_revisions r ON r.idea_id=i.id AND r.id=a.revision_id WHERE c.normalized_email='${marker}@example.invalid' AND i.publication_state='approved' AND r.review_state='approved'`
  const sourceVisible = await sql(source, visibleQuery)
  const restoredVisible = await sql(target, visibleQuery)
  const holdQuery = `SELECT count(*) FROM legal_holds h JOIN ideas i ON i.id=h.idea_id JOIN contacts c ON c.id=i.author_contact_id WHERE c.normalized_email='${marker}@example.invalid' AND h.released_at IS NULL`
  const sourceHolds = await sql(source, holdQuery)
  const restoredHolds = await sql(target, holdQuery)
  const authorityQuery = `SELECT count(*) FROM legal_hold_assignments WHERE user_id='${director}'`
  const sourceAuthority = await sql(source, authorityQuery)
  const restoredAuthority = await sql(target, authorityQuery)
  const actorQuery = `SELECT count(*) FROM users WHERE id='${director}'`
  const sourceActor = await sql(source, actorQuery)
  const restoredActor = await sql(target, actorQuery)
  const laterRevisionQuery = `SELECT count(*) FROM idea_revisions WHERE idea_id='${ideaId}' AND version=2`
  const sourceLaterRevision = await sql(source, laterRevisionQuery)
  const restoredLaterRevision = await sql(target, laterRevisionQuery)
  let summary, recoveryRecords
  const inventoryEmulator = process.env.STORAGE_EMULATOR_HOST
  delete process.env.STORAGE_EMULATOR_HOST
  try {
    const preparedInventory = await prepareUnverifiedRecoveryInventory(journal, journalTarget)
    if (preparedInventory.coverageVerified !== false || preparedInventory.references.length !== 4) {
      throw new Error('Synthetic journal inventory failed verification')
    }
    const comparison = compareUnverifiedRecoveryCheckpoint(syntheticCheckpoint, preparedInventory.references)
    if (comparison.coverageVerified !== false || comparison.missing.length || comparison.changed.length ||
        comparison.additional.length !== 2) throw new Error('Synthetic checkpoint comparison failed')
    const withoutCheckpointRecord = preparedInventory.references.filter(reference => reference.recordId !== syntheticCheckpoint[0].recordId)
    const missing = compareUnverifiedRecoveryCheckpoint(syntheticCheckpoint, withoutCheckpointRecord)
    if (missing.coverageVerified !== false || missing.missing.length !== 1 || missing.missing[0] !== syntheticCheckpoint[0].recordId) {
      throw new Error('Synthetic missing checkpoint record was not detected')
    }
    recoveryRecords = preparedInventory.records
    summary = preparedInventory.summary
    const holdIntent = recoveryRecords.find(record => {
      const decoded = decodeRecoveryRecord(record, 'dev')
      return decoded.operationId === holdOperation && decoded.recordType === 'intent'
    })
    const holdConfirmation = recoveryRecords.find(record => {
      const decoded = decodeRecoveryRecord(record, 'dev')
      return decoded.operationId === holdOperation && decoded.recordType === 'hold_commit_confirmation'
    })
    if (!holdIntent || !holdConfirmation) throw new Error('Synthetic hold records are missing')
    const checked = await verifyUnverifiedHeldCapture(journal, journalTarget, holdIntent, holdConfirmation)
    if (heldReference.coverageVerified !== false || manifestReference.coverageVerified !== false ||
        checked.coverageVerified !== false || checked.checkedArtifacts !== 1 || checked.totalBytes !== heldReference.size) {
      throw new Error('Synthetic held material readback failed')
    }
  } finally {
    if (inventoryEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
    else process.env.STORAGE_EMULATOR_HOST = inventoryEmulator
  }
  if (summary.coverageVerified !== false || summary.removals.length !== 1 || summary.removals[0] !== ideaId ||
      summary.holdPlacements.length !== 1 || summary.holdPlacements[0] !== ideaId ||
      summary.holdReviewIdeas.length !== 1 || summary.holdReviewIdeas[0] !== ideaId || summary.holdIdentities.length !== 1 ||
      summary.holdIdentities[0].operationId !== holdOperation || summary.holdIdentities[0].ideaId !== ideaId ||
      summary.holdIdentities[0].holdId !== committedHoldId || summary.holdIdentities[0].placementAuthorityId !== committedAuthorityId ||
      summary.holdIdentities[0].placedAt !== committedPlacedAt ||
      JSON.stringify(summary.holdIdentities[0].authorityEvidence) !== JSON.stringify(committedAuthority) || summary.reviewOperations.length !== 1 ||
      summary.reviewOperations[0] !== holdOperation || summary.unmatchedConfirmations !== 0) {
    throw new Error('Synthetic journal summary failed verification')
  }
  // The target stays isolated. Exercise the real projection and preview queries
  // internally, without opening the gate or claiming complete reconciliation.
  const recoveryPool = new pg.Pool({ connectionString: `postgres://idea_map:synthetic-local-only@127.0.0.1:${port}/${target}`,
    max: 2, connectionTimeoutMillis: 5000 })
  const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  let previewReads = 0
  const previewStorage = { bucket: bucket => ({ file: (name, options) => {
    if (bucket !== 'synthetic-public' || name !== 'synthetic-preview' || options.preconditionOpts.ifGenerationMatch !== '1') {
      throw new Error('Unexpected synthetic preview reference')
    }
    return { interceptors: [],
      async getMetadata() { previewReads++; return [{ generation: '1', size: String(imageBytes.length), contentType: 'image/png' }] },
      createReadStream() { return Readable.from([imageBytes]) },
    }
  } }) }
  const readRecoveryContent = async () => {
    const client = await recoveryPool.connect()
    try {
      return { idea: await readPublishedIdea('', ideaId, client),
        preview: await readMediaPreview(client, previewStorage, 'synthetic-public', previewId, 1024) }
    } finally { client.release() }
  }
  let reconciledVisible
  try {
    const before = await readRecoveryContent()
    if (before.idea?.title !== 'Synthetic title' || !before.preview?.bytes.equals(imageBytes) || previewReads !== 1) {
      throw new Error('Synthetic restored public content was not observed')
    }
    let lease
    try { lease = await acquirePublicAccessLease(recoveryPool) }
    catch (error) { if (error.message !== 'Public access unavailable') throw error }
    if (lease) { await lease.release(); throw new Error('Synthetic restored gate permitted public access') }
    // The independent fence stays active while the database gate is briefly
    // opened to verify that the suppression primitive refuses an unsafe target.
    await sql(target, 'UPDATE public.public_access_gate SET is_open=true WHERE singleton=true')
    let rejectedOpenGate = false
    try { await suppressUnverifiedRestoredRemovals(recoveryPool, recoveryRecords, 'dev') }
    catch (error) { rejectedOpenGate = error.message === 'Recovery suppression outcome is uncertain' }
    finally { await sql(target, 'UPDATE public.public_access_gate SET is_open=false WHERE singleton=true') }
    if (!rejectedOpenGate || (await sql(target, visibleQuery)) !== '1') throw new Error('Synthetic suppression accepted an open gate')
    const removalIntent = recoveryRecords.find(record => {
      const decoded = decodeRecoveryRecord(record, 'dev')
      return decoded.recordType === 'intent' && decoded.operationId === removalOperation
    })
    if (!removalIntent) throw new Error('Synthetic removal intent is missing')
    const coordinatorEmulator = process.env.STORAGE_EMULATOR_HOST
    delete process.env.STORAGE_EMULATOR_HOST
    try {
      const coordinated = await suppressKnownRemovalsFromJournal(journal, journalTarget, recoveryPool)
      if (JSON.stringify(coordinated) !== JSON.stringify({ matched: 1, absent: 0, reviewOperations: 1, coverageVerified: false }) ||
          (await sql(target, visibleQuery)) !== '0') throw new Error('Synthetic inventory did not suppress the restored removal')
      if (await sql(target, 'SELECT is_open FROM public.public_access_gate WHERE singleton=true') !== 'f') {
        throw new Error('Synthetic inventory and suppression opened the public gate')
      }
    } finally {
      if (coordinatorEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
      else process.env.STORAGE_EMULATOR_HOST = coordinatorEmulator
    }
    // Recreate the pre-suppression state only inside the independently fenced
    // synthetic target to exercise an unconfirmed intent separately.
    await sql(target, `UPDATE ideas SET publication_state='approved' WHERE id='${ideaId}'; UPDATE media_previews SET published=true WHERE id='${previewId}'`)
    const uncertain = await suppressUnverifiedRestoredRemovals(recoveryPool, [removalIntent], 'dev')
    if (JSON.stringify(uncertain) !== JSON.stringify({ matched: 1, absent: 0, reviewOperations: 1, coverageVerified: false }) ||
        (await sql(target, visibleQuery)) !== '0') {
      throw new Error('Synthetic uncertain removal was not suppressed for review')
    }
    const suppressed = await suppressUnverifiedRestoredRemovals(recoveryPool, recoveryRecords, 'dev')
    const retried = await suppressUnverifiedRestoredRemovals(recoveryPool, recoveryRecords, 'dev')
    if (JSON.stringify(suppressed) !== JSON.stringify({ matched: 1, absent: 0, reviewOperations: 1, coverageVerified: false }) ||
        JSON.stringify(retried) !== JSON.stringify(suppressed)) throw new Error('Synthetic suppression was not idempotent')
    const missingIntent = encodeRecoveryIntent({ ...base, ideaId: randomUUID(), operationId: randomUUID(),
      decision: { kind: 'removal', classification: 'other', reason: 'synthetic uncertain removal' } })
    const withMissing = await suppressUnverifiedRestoredRemovals(recoveryPool, [...recoveryRecords, missingIntent], 'dev')
    if (JSON.stringify(withMissing) !== JSON.stringify({ matched: 1, absent: 1, reviewOperations: 2, coverageVerified: false })) {
      throw new Error('Synthetic missing removal was not reported for review')
    }
    const empty = await suppressUnverifiedRestoredRemovals(recoveryPool, [], 'dev')
    if (JSON.stringify(empty) !== JSON.stringify({ matched: 0, absent: 0, reviewOperations: 0, coverageVerified: false })) {
      throw new Error('Empty synthetic suppression was ambiguous')
    }
    for (const invalid of [[ideaId, ideaId], [ideaId, null]]) {
      let rejected = false
      try { await recoveryPool.query('SELECT * FROM public.suppress_restored_removals($1::uuid[])', [invalid]) }
      catch (error) { rejected = error.message.includes('Invalid recovery suppression') }
      if (!rejected) throw new Error('Synthetic invalid suppression input was accepted')
    }
    if (await sql(target, `SELECT published FROM media_previews WHERE id='${previewId}'`) !== 'f') {
      throw new Error('Synthetic preview metadata remained published')
    }
    const after = await readRecoveryContent()
    if (after.idea !== null || after.preview !== null || previewReads !== 1) throw new Error('Synthetic removal remained publicly readable')
    reconciledVisible = await sql(target, visibleQuery)
  } finally { await recoveryPool.end() }
  const functionPrivilege = "SELECT has_function_privilege('public','public.place_legal_hold_outcome(text,text,uuid,text,text)','EXECUTE')"
  const sourcePublicExecute = await sql(source, functionPrivilege)
  const restoredPublicExecute = await sql(target, functionPrivilege)
  const restoredNamedExecute = await sql(target, namedPrivilege)
  const pendingPrivilege = "SELECT has_function_privilege('public','public.prepare_pending_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE')"
  const restoredPendingPublicExecute = await sql(target, pendingPrivilege)
  const applyPrivilege = "SELECT has_function_privilege('public','public.apply_pending_removal(text,text,uuid,uuid,text,text)','EXECUTE')"
  const restoredApplyPublicExecute = await sql(target, applyPrivilege)
  const confirmationPrivilege = "SELECT has_function_privilege('public','public.prepare_pending_removal_confirmation(text,text,uuid,uuid,text,text,timestamptz,uuid)','EXECUTE')"
  const restoredConfirmationPublicExecute = await sql(target, confirmationPrivilege)
  const applicationTriggerPrivilege = "SELECT has_function_privilege('public','public.protect_pending_removal_application()','EXECUTE')"
  const restoredTriggerPublicExecute = await sql(target, applicationTriggerPrivilege)
  const restoredApplicationTrigger = await sql(target, "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.public_access_pending_decisions'::regclass AND tgname='protect_pending_removal_application' AND NOT tgisinternal AND tgenabled='O'")
  const verificationPrivilege = "SELECT has_function_privilege('public','public.verify_pending_removal_confirmation(text,text,uuid,uuid,timestamptz,text)','EXECUTE')"
  const restoredVerificationPublicExecute = await sql(target, verificationPrivilege)
  const verificationTriggerPrivilege = "SELECT has_function_privilege('public','public.protect_pending_confirmation_verification()','EXECUTE')"
  const restoredVerificationTriggerPublicExecute = await sql(target, verificationTriggerPrivilege)
  const suppressionPrivilege = "SELECT has_function_privilege('public','public.suppress_restored_removals(uuid[])','EXECUTE')"
  const restoredSuppressionPublicExecute = await sql(target, suppressionPrivilege)
  const pinPrivilege = "SELECT has_function_privilege('public','public.pin_pending_removal_sequence(text,text,uuid,uuid,text,text,text,uuid)','EXECUTE')"
  const restoredPinPublicExecute = await sql(target, pinPrivilege)
  const sequenceApplyPrivilege = "SELECT has_function_privilege('public','public.apply_pending_sequence_removal(text,text,uuid,uuid,text,text,text,text,text,uuid)','EXECUTE')"
  const restoredSequenceApplyPublicExecute = await sql(target, sequenceApplyPrivilege)
  const sequenceConfirmationPrivilege = "SELECT has_function_privilege('public','public.verify_pending_sequence_confirmation(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid)','EXECUTE')"
  const restoredSequenceConfirmationPublicExecute = await sql(target, sequenceConfirmationPrivilege)
  const pinTriggerPrivilege = "SELECT has_function_privilege('public','public.protect_pending_sequence_target()','EXECUTE')"
  const restoredPinTriggerPublicExecute = await sql(target, pinTriggerPrivilege)
  const restoredPinTrigger = await sql(target, "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.public_access_pending_decisions'::regclass AND tgname='protect_pending_sequence_target' AND NOT tgisinternal AND tgenabled='O'")
  const restoredVerificationTrigger = await sql(target, "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.public_access_pending_decisions'::regclass AND tgname='protect_pending_confirmation_verification' AND NOT tgisinternal AND tgenabled='O'")
  const restoredGateOpen = await sql(target, 'SELECT is_open FROM public.public_access_gate WHERE singleton=true')
  const publicConnect = await sql(source, `SELECT has_database_privilege('public','${target}','CONNECT')`)
  const namedConnect = await sql(source, `SELECT has_database_privilege('${reader}','${target}','CONNECT')`)
  if (restored !== '1' || excluded !== '0' || postgis !== '1' || ideas !== '1' || Number(migrations) < 1 || sourceVisible !== '0' || restoredVisible !== '1' || reconciledVisible !== '0' || sourceHolds !== '1' || restoredHolds !== '0' || sourceAuthority !== '1' || restoredAuthority !== '0' || sourceActor !== '1' || restoredActor !== '0' || sourceLaterRevision !== '1' || restoredLaterRevision !== '0' || sourcePublicExecute !== 'f' || restoredPublicExecute !== 'f' || restoredPendingPublicExecute !== 'f' || restoredApplyPublicExecute !== 'f' || restoredConfirmationPublicExecute !== 'f' || restoredTriggerPublicExecute !== 'f' || restoredApplicationTrigger !== '1' ||
      restoredVerificationPublicExecute !== 'f' || restoredVerificationTriggerPublicExecute !== 'f' ||
      restoredVerificationTrigger !== '1' || restoredSuppressionPublicExecute !== 'f' || restoredPinPublicExecute !== 'f' || restoredSequenceApplyPublicExecute !== 'f' ||
      restoredSequenceConfirmationPublicExecute !== 'f' ||
      restoredPinTriggerPublicExecute !== 'f' || restoredPinTrigger !== '1' || restoredGateOpen !== 'f' || sourceNamedExecute !== 't' || restoredNamedExecute !== 't' || publicConnect !== 'f' || namedConnect !== 'f') throw new Error('Restored synthetic database failed verification')
  const lossMs = Number(latest) - Number(captured)
  if (!Number.isFinite(lossMs) || lossMs < 0) throw new Error('Synthetic data-loss interval could not be measured')
  console.log(JSON.stringify({ backupSeconds: (backupFinished - dumpStarted) / 1000,
    recoverySeconds: (Date.now() - recoveryStarted) / 1000, dataLossSeconds: lossMs / 1000,
    migrations: Number(migrations), postgisRestored: true, syntheticRemovalSuppressed: true,
    syntheticPreviewSuppressed: true, heldEvidenceRequiresReconciliation: true,
    holdAuthorityRequiresReconciliation: true,
    journalCoverageVerified: false, syntheticGrantAndRevocationRestored: true, missingRoleRejected: true,
    restoredOpenGateFenced: true, missingGateFenced: true, databaseAccessFenced: true }))
} finally {
  try {
    if (created) {
      const label = await docker('inspect', '--format', '{{index .Config.Labels "idea-map.recovery-test"}}', container).catch(() => '')
      if (label !== id) throw new Error('Synthetic container ownership could not be confirmed; retain it for investigation')
      await docker('rm', '-f', '-v', container)
    }
  } finally {
    const resolved = await realpath(scratch)
    if (dirname(resolved) !== scratchRoot || !basename(resolved).startsWith('idea-map-recovery-')) {
      throw new Error('Synthetic scratch ownership could not be confirmed; retain it for investigation')
    }
    await rm(resolved, { recursive: true, force: true })
  }
}
