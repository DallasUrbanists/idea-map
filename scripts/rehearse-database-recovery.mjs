import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { dumpArguments, exportEncryptedBackup } from '../apps/worker/ops/export-encrypted-backup.mjs'
import { encodeRecoveryConfirmation, encodeRecoveryHoldConfirmation, encodeRecoveryIntent } from '../packages/server/dist/recovery-journal-record.js'
import { summarizeUnverifiedRecovery } from '../packages/server/dist/recovery-journal-plan.js'
import { writeRecoveryJournalRecord } from '../packages/server/dist/recovery-journal-storage.js'

// The rehearsal owns every target it creates. It has no database or bucket inputs.
const id = randomUUID()
const container = `idea-map-recovery-${id}`
const source = 'idea_map_test_recovery_source'
const target = 'idea_map_test_recovery_target'
const unpreparedTarget = 'idea_map_test_recovery_unprepared'
const marker = `synthetic-${id}`
const director = randomUUID()
const reader = `recovery_reader_${id.replaceAll('-', '')}`
const scratchRoot = await realpath(tmpdir())
const scratch = await mkdtemp(join(scratchRoot, 'idea-map-recovery-'))
const archive = join(scratch, 'synthetic.pgdump')
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
  await sql(source, `CREATE ROLE ${reader} NOLOGIN; GRANT EXECUTE ON FUNCTION public.place_legal_hold_outcome(text,text,uuid,text,text) TO ${reader}`)
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
  await sql(source, `INSERT INTO synthetic_recovery_marker(id) VALUES ('${marker}-after'); INSERT INTO idea_revisions(idea_id,version,content) VALUES ('${ideaId}',2,'{"title":"Synthetic later held material"}'::jsonb); INSERT INTO users(id) VALUES ('${director}'); INSERT INTO identities(user_id,provider,subject) VALUES ('${director}','firebase:demo-idea-map','${marker}'); INSERT INTO moderator_assignments(user_id,granted_by,grant_reason) VALUES ('${director}','${director}','synthetic grant'); INSERT INTO legal_hold_assignments(user_id,authority,authorization_reference,granted_by) VALUES ('${director}','executive_director','synthetic authority','${director}')`)
  const entries = []
  const journal = { bucket: () => ({ file: () => ({ createWriteStream(options) {
    if (options.preconditionOpts.ifGenerationMatch !== 0 || options.validation !== 'crc32c') throw new Error('Synthetic journal safeguards missing')
    const chunks = []
    return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
      final(callback) { entries.push(Buffer.concat(chunks)); callback() } })
  } }) }) }
  const journalTarget = { environment: 'dev', bucket: 'synthetic-private-backups' }
  const removalOperation = randomUUID()
  const holdOperation = randomUUID()
  let committedHoldId
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
    const removed = await sql(source, `SELECT public.remove_published_idea('firebase:demo-idea-map','${marker}','${ideaId}','${revisionId}','other','synthetic removal')`)
    if (removed !== 'removed') throw new Error('Synthetic removal failed')
    const holdOutcome = await sql(source, `SELECT public.place_legal_hold_outcome('firebase:demo-idea-map','${marker}','${ideaId}','synthetic case','synthetic preservation')`)
    if (holdOutcome !== 'processed') throw new Error('Synthetic legal hold failed')
    committedHoldId = await sql(source, `SELECT id FROM legal_holds WHERE idea_id='${ideaId}' AND case_reference='synthetic case' AND released_at IS NULL`)
    if (!/^[0-9a-f-]{36}$/.test(committedHoldId)) throw new Error('Synthetic hold identity is ambiguous')
    const confirmedAt = new Date().toISOString()
    await writeRecoveryJournalRecord(journal, journalTarget, randomUUID(), encodeRecoveryConfirmation(removalOperation, 'dev', confirmedAt))
    await writeRecoveryJournalRecord(journal, journalTarget, randomUUID(), encodeRecoveryHoldConfirmation(holdOperation, 'dev', confirmedAt, committedHoldId))
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
  await docker('exec', container, 'createdb', '-U', 'idea_map', '-T', 'template0', target)
  await sql(source, `REVOKE CONNECT ON DATABASE ${target} FROM PUBLIC`)
  const restore = start('docker', ['exec', '-i', container, 'pg_restore', '-U', 'idea_map', '--no-owner', '--exit-on-error', '-d', target])
  restore.child.stdout.resume()
  await Promise.all([pipeline(createReadStream(archive), restore.child.stdin), restore.done])
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
  const summary = summarizeUnverifiedRecovery(entries, 'dev')
  if (summary.coverageVerified !== false || summary.removals.length !== 1 || summary.removals[0] !== ideaId ||
      summary.holdPlacements.length !== 1 || summary.holdPlacements[0] !== ideaId || summary.holdIdentities.length !== 1 ||
      summary.holdIdentities[0].operationId !== holdOperation || summary.holdIdentities[0].ideaId !== ideaId ||
      summary.holdIdentities[0].holdId !== committedHoldId || summary.reviewOperations.length !== 0 || summary.unmatchedConfirmations !== 0) {
    throw new Error('Synthetic journal summary failed verification')
  }
  // This conservative local update suppresses the known removal while the
  // target stays isolated. It is not a complete live reconciliation procedure.
  await sql(target, `UPDATE ideas SET publication_state='withdrawn' WHERE id='${ideaId}'`)
  const reconciledVisible = await sql(target, visibleQuery)
  const functionPrivilege = "SELECT has_function_privilege('public','public.place_legal_hold_outcome(text,text,uuid,text,text)','EXECUTE')"
  const sourcePublicExecute = await sql(source, functionPrivilege)
  const restoredPublicExecute = await sql(target, functionPrivilege)
  const restoredNamedExecute = await sql(target, namedPrivilege)
  const pendingPrivilege = "SELECT has_function_privilege('public','public.prepare_pending_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE')"
  const restoredPendingPublicExecute = await sql(target, pendingPrivilege)
  const restoredGateOpen = await sql(target, 'SELECT is_open FROM public.public_access_gate WHERE singleton=true')
  const publicConnect = await sql(source, `SELECT has_database_privilege('public','${target}','CONNECT')`)
  const namedConnect = await sql(source, `SELECT has_database_privilege('${reader}','${target}','CONNECT')`)
  if (restored !== '1' || excluded !== '0' || postgis !== '1' || ideas !== '1' || Number(migrations) < 1 || sourceVisible !== '0' || restoredVisible !== '1' || reconciledVisible !== '0' || sourceHolds !== '1' || restoredHolds !== '0' || sourceAuthority !== '1' || restoredAuthority !== '0' || sourceActor !== '1' || restoredActor !== '0' || sourceLaterRevision !== '1' || restoredLaterRevision !== '0' || sourcePublicExecute !== 'f' || restoredPublicExecute !== 'f' || restoredPendingPublicExecute !== 'f' || restoredGateOpen !== 'f' || sourceNamedExecute !== 't' || restoredNamedExecute !== 't' || publicConnect !== 'f' || namedConnect !== 'f') throw new Error('Restored synthetic database failed verification')
  const lossMs = Number(latest) - Number(captured)
  if (!Number.isFinite(lossMs) || lossMs < 0) throw new Error('Synthetic data-loss interval could not be measured')
  console.log(JSON.stringify({ backupSeconds: (backupFinished - dumpStarted) / 1000,
    recoverySeconds: (Date.now() - recoveryStarted) / 1000, dataLossSeconds: lossMs / 1000,
    migrations: Number(migrations), postgisRestored: true, syntheticRemovalSuppressed: true, heldEvidenceRequiresReconciliation: true,
    holdAuthorityRequiresReconciliation: true,
    journalCoverageVerified: false, syntheticGrantAndRevocationRestored: true, missingRoleRejected: true, databaseAccessFenced: true }))
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
