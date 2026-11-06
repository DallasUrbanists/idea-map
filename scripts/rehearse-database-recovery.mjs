import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { createRequire } from 'node:module'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultAclDigestSql, dumpArguments, exportEncryptedBackup, openBackupSnapshot } from '../apps/worker/ops/export-encrypted-backup.mjs'
import { decodeRecoveryRecord, encodeRecoveryIntent } from '../packages/server/dist/recovery-journal-record.js'
import { encodeRecoverySequenceEntry } from '../packages/server/dist/recovery-sequence.js'
import { unverifiedRolloverCheckpoint } from '../packages/server/dist/recovery-sequence-rollover.js'
import { decodeUnverifiedHeldManifest } from '../packages/server/dist/recovery-held-manifest.js'
import { captureAuthorizedHeldInventory, listAuthorizedHeldSourceCandidates } from '../packages/server/dist/held-inventory-capture.js'
import { recordJournaledHoldScopeReview } from '../packages/server/dist/journaled-hold-scope.js'
import { verifyRolloverHeldCaptures, verifySequenceChainHeldCaptures, verifySequenceHeldCaptures } from '../packages/server/dist/recovery-held-verification.js'
import { reconcileFencedRecoveryFromSequence, suppressKnownRemovalsFromRollover, suppressKnownRemovalsFromSequence, suppressKnownRemovalsFromSequenceChain, suppressUnverifiedRestoredRemovals } from '../packages/server/dist/recovery-suppression.js'
import { appendAndVerifyRecoverySequenceVersion, readUnverifiedRecoverySequence } from '../packages/server/dist/recovery-sequence-storage.js'
import { readUnverifiedHeldMaterial } from '../packages/server/dist/recovery-held-storage.js'
import { acquirePublicAccessLease } from '../packages/server/dist/public-access-lease.js'
import { pendingRemovalDatabasePool, runtimeDatabasePool } from '../packages/server/dist/runtime-database.js'
import { readPublishedIdea } from '../packages/server/dist/published-ideas.js'
import { readMediaPreview } from '../packages/server/dist/media-preview.js'
import { createJournaledHoldPlacementHandler, createJournaledRemovalHandler } from '../apps/web/server/utils/journaled-removal.ts'

const { CRC32C } = createRequire(new URL('../packages/server/package.json', import.meta.url))('@google-cloud/storage')
const pg = createRequire(new URL('../packages/server/package.json', import.meta.url))('pg')
const { createApp, toNodeListener } = createRequire(new URL('../apps/web/package.json', import.meta.url))('h3')

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
  // Every subprocess in this rehearsal uses its own synthetic inputs.
  let diagnostic = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000) })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${diagnostic.trim()}`)))
  })
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

async function exerciseRemovalRequest(databaseUrl, journalConfig, writer, reader, request, subject, makeJournalUnavailable, reviewHeldScope) {
  const publicRole = 'synthetic_removal_reader'
  const preparationRole = 'synthetic_removal_preparer'
  const coordinatorRole = 'synthetic_removal_coordinator'
  const roleUrl = role => {
    const url = new URL(databaseUrl)
    url.username = role
    url.password = 'synthetic-role-only'
    return url.toString()
  }
  const config = {
    databaseUrl: roleUrl(publicRole), firebaseProjectId: 'demo-idea-map', authProviderMode: 'offline', sessionOrigin: '',
    journaledRemoval: {
      ...journalConfig, enabled: true, holdPlacementEnabled: true, preparationDatabaseUrl: roleUrl(preparationRole), coordinatorDatabaseUrl: roleUrl(coordinatorRole),
      writerAccount: 'synthetic-writer', readerAccount: 'synthetic-reader',
    },
  }
  await sql(source, `
    CREATE ROLE ${publicRole} LOGIN PASSWORD 'synthetic-role-only';
    CREATE ROLE ${preparationRole} LOGIN PASSWORD 'synthetic-role-only';
    CREATE ROLE ${coordinatorRole} LOGIN PASSWORD 'synthetic-role-only';
    GRANT EXECUTE ON FUNCTION public.public_access_allowed() TO ${publicRole};
    GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text),
      public.prepare_journaled_removal(text,text,uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,text),
      public.lock_active_legal_hold_authority(text,text),
      public.prepare_journaled_hold_placement(text,text,uuid,uuid,text,text,text,text,text,uuid,text) TO ${preparationRole};
    GRANT EXECUTE ON FUNCTION public.lock_active_moderator(text,text),
      public.pin_pending_removal_sequence(text,text,uuid,uuid,text,text,text,uuid),
      public.apply_pending_sequence_removal(text,text,uuid,uuid,text,text,text,text,text,uuid),
      public.pending_sequence_removal_status(text,text,uuid,uuid,text,text,text,text,uuid),
      public.prepare_pending_removal_confirmation(text,text,uuid,uuid,text,text,timestamptz,uuid),
      public.pending_sequence_confirmation_status(text,text,uuid,uuid,text,text,timestamptz,uuid,timestamptz,text,text,text,uuid),
      public.verify_pending_sequence_confirmation(text,text,uuid,uuid,timestamptz,text,text,text,text,uuid),
      public.resolve_journaled_removal(text,text,uuid,uuid,text,text,text,uuid,text),
      public.lock_active_legal_hold_authority(text,text),
      public.advance_journaled_hold_placement(text,text,uuid,uuid,text,text,text,uuid,text,integer,integer),
      public.advance_journaled_hold_scope_review(text,text,uuid,uuid,text,text,text,uuid,text,integer,integer) TO ${coordinatorRole};
  `)
  const privileges = await sql(source, `SELECT
    NOT has_table_privilege('${coordinatorRole}','public.public_access_gate','UPDATE')
    AND NOT has_function_privilege('${preparationRole}','public.apply_pending_sequence_removal(text,text,uuid,uuid,text,text,text,text,text,uuid)','EXECUTE')
    AND NOT has_function_privilege('${coordinatorRole}','public.remove_published_idea(text,text,uuid,uuid,text,text)','EXECUTE')
    AND NOT has_function_privilege('${coordinatorRole}','public.apply_pending_removal(text,text,uuid,uuid,text,text)','EXECUTE')
    AND NOT has_function_privilege('${coordinatorRole}','public.authorize_journaled_public_access(text,text,text,uuid,text)','EXECUTE')
    AND NOT has_function_privilege('${preparationRole}','public.place_legal_hold_outcome(text,text,uuid,text,text)','EXECUTE')
    AND NOT has_function_privilege('${coordinatorRole}','public.release_legal_hold_outcome(text,text,uuid,text,text)','EXECUTE')
    AND NOT has_table_privilege('${coordinatorRole}','public.legal_hold_journal_placements','UPDATE')`)
  if (privileges !== 't') throw new Error('Synthetic removal roles can bypass the journal')
  const { environment, projectNumber, secretId, epochId, checkpointDigest } = journalConfig
  await sql(source, `UPDATE public.public_access_gate SET is_open=false WHERE singleton=true;
    SELECT public.authorize_journaled_public_access('${environment}','${projectNumber}','${secretId}','${epochId}','${checkpointDigest}')`)
  const email = 'synthetic-moderator@example.invalid'
  const verifier = {
    async verifySessionCookie(cookie) {
      if (!['synthetic-cookie', 'synthetic-non-moderator'].includes(cookie)) {
        throw Object.assign(new Error('Invalid synthetic cookie'), { code: 'auth/invalid-session-cookie' })
      }
      return { uid: cookie === 'synthetic-cookie' ? subject : 'unassigned-synthetic-user', email, email_verified: true,
        firebase: { sign_in_provider: 'password' } }
    },
    async getUser(uid) { return { uid, email, emailVerified: true, disabled: false } },
  }
  const app = createApp()
  const path = '/api/moderation/removal'
  let transportCreations = 0
  const getTransports = () => {
    transportCreations++
    return { writer, reader }
  }
  app.use(path, createJournaledRemovalHandler(() => config, () => verifier, getTransports))
  const holdPath = '/api/moderation/legal-hold'
  app.use(holdPath, createJournaledHoldPlacementHandler(() => config, () => verifier, getTransports))
  const holdRequest = { ideaId: request.ideaId, requestId: randomUUID(), caseReference: 'synthetic-journaled-hold', reason: 'Synthetic preservation' }
  let journaledHoldId
  const server = createServer(toNodeListener(app))
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
    config.sessionOrigin = `http://127.0.0.1:${server.address().port}`
    const send = (cookie = 'synthetic-cookie', origin = config.sessionOrigin, body = request, endpoint = path) => fetch(config.sessionOrigin + endpoint, {
      method: 'POST', headers: { cookie: `__session=${cookie}`, origin, 'content-type': 'application/json', 'x-idea-map-session': 'IdeaMapSession' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    })
    for (const [response, expected] of [
      [await send('invalid'), 401],
      [await send('synthetic-non-moderator'), 403],
      [await send('synthetic-cookie', 'https://example.invalid'), 403],
      [await send('synthetic-cookie', config.sessionOrigin, { ...request, approvedRevisionId: randomUUID() }), 409],
    ]) {
      if (response.status !== expected || response.headers.get('cache-control') !== 'private, no-store') {
        throw new Error(`Synthetic removal request expected ${expected}, received ${response.status}`)
      }
      await response.arrayBuffer()
    }
    if (await sql(source, 'SELECT public.public_access_allowed()') !== 't') throw new Error('Rejected requests closed the gate')
    const sendHold = (cookie = 'synthetic-cookie') => send(cookie, config.sessionOrigin, holdRequest, holdPath)
    const deniedHold = await sendHold('synthetic-non-moderator')
    await deniedHold.arrayBuffer()
    if (deniedHold.status !== 403 || await sql(source, `SELECT public.lock_idea_for_retention('${request.ideaId}')`) !== 't') {
      throw new Error('An unassigned identity could place a legal hold')
    }
    makeJournalUnavailable(true)
    const pendingHold = await sendHold()
    await pendingHold.arrayBuffer()
    if (pendingHold.status !== 503 || await sql(source, `SELECT public.lock_idea_for_retention('${request.ideaId}')`) !== 'f' ||
        await sql(source, 'SELECT public.public_access_allowed()') !== 't') {
      throw new Error('An interrupted hold placement failed to preserve primary data')
    }
    journaledHoldId = await sql(source, `SELECT hold_id FROM legal_hold_journal_placements WHERE request_id='${holdRequest.requestId}'`)
    makeJournalUnavailable(false)
    for (let attempt = 0; attempt < 2; attempt++) {
      const holdResponse = await sendHold()
      const hold = await holdResponse.json()
      if (holdResponse.status !== 200 || hold.state !== 'held' || hold.scope !== 'provisional' || hold.holdId !== journaledHoldId) {
        throw new Error(`Synthetic hold retry failed with HTTP ${holdResponse.status}`)
      }
    }
    if (await sql(source, `SELECT count(*) FROM legal_hold_journal_placements WHERE hold_id='${journaledHoldId}' AND confirmation_version>intent_version`) !== '1') {
      throw new Error('Synthetic hold confirmation is missing')
    }
    makeJournalUnavailable(true)
    const failed = await send()
    if (failed.status !== 503 || await sql(source, 'SELECT public.public_access_allowed()') !== 'f' ||
        await sql(source, `SELECT publication_state FROM public.ideas WHERE id='${request.ideaId}'`) !== 'approved') {
      throw new Error('Unavailable journal failed to keep the accepted removal safely pending')
    }
    await failed.arrayBuffer()
    const overlapping = await send('synthetic-cookie', config.sessionOrigin, { ...request, operationId: randomUUID() })
    await overlapping.arrayBuffer()
    if (overlapping.status !== 409) throw new Error('An overlapping request was allowed to prepare a second removal')
    makeJournalUnavailable(false)
    const removed = await send()
    const status = await removed.json()
    if (removed.status !== 200 || status.state !== 'removed' || status.publicAccess !== 'open' ||
        await sql(source, 'SELECT public.public_access_allowed()') !== 't' ||
        await sql(source, `SELECT publication_state FROM public.ideas WHERE id='${request.ideaId}'`) !== 'withdrawn') {
      throw new Error(`Synthetic removal retry failed with HTTP ${removed.status}`)
    }
    await reviewHeldScope(journaledHoldId, config.journaledRemoval.coordinatorDatabaseUrl)
    const recoveryClosure = randomUUID()
    await sql(source, `SELECT public.place_independent_access_closure('recovery','${recoveryClosure}')`)
    const replayed = await send()
    const replayStatus = await replayed.json()
    if (replayed.status !== 200 || replayStatus.state !== 'removed' || replayStatus.publicAccess !== 'paused' ||
        await sql(source, `SELECT public.inspect_independent_access_closure('recovery','${recoveryClosure}')`) !== 't') {
      throw new Error('A removal retry cleared the independent recovery closure')
    }
    if (transportCreations !== 2) throw new Error('The journal routes discarded their provider clients on retry')
    return journaledHoldId
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await Promise.all([pendingRemovalDatabasePool(config.journaledRemoval.preparationDatabaseUrl).end(),
      pendingRemovalDatabasePool(config.journaledRemoval.coordinatorDatabaseUrl).end(),
      runtimeDatabasePool(config.journaledRemoval.preparationDatabaseUrl).end(),
      runtimeDatabasePool(config.journaledRemoval.coordinatorDatabaseUrl).end()])
  }
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
  // The certificate and trust store exist only inside this disposable fixture.
  await docker('exec', '-u', '0', container, 'bash', '-c', `set -eu
cd "$PGDATA"
openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 1 -subj '/CN=issue32-synthetic' -addext 'subjectAltName=IP:127.0.0.1' -addext 'basicConstraints=critical,CA:TRUE' >/dev/null 2>&1
chown postgres:postgres server.key server.crt
chmod 600 server.key
cp server.crt /usr/local/share/ca-certificates/issue32-test.crt
update-ca-certificates >/dev/null 2>&1`)
  await sql(source, "ALTER SYSTEM SET ssl = 'on'")
  await sql(source, 'SELECT pg_reload_conf()')
  const tlsEnvironment = ['-e', 'PGHOST=127.0.0.1', '-e', 'PGPORT=5432', '-e', 'PGUSER=idea_map',
    '-e', 'PGPASSWORD=synthetic-local-only', '-e', `PGDATABASE=${source}`, '-e', 'PGSSLMODE=verify-full',
    '-e', 'PGSSLROOTCERT=system', '-e', 'PGGSSENCMODE=disable', '-e', 'PGCONNECT_TIMEOUT=5']
  const tlsQuery = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
    'SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()']
  let tlsReady = false
  for (let attempt = 0; attempt < 30 && !tlsReady; attempt++) {
    try { tlsReady = (await docker('exec', ...tlsEnvironment, container, ...tlsQuery)) === 't' }
    catch { await delay(200) }
  }
  if (!tlsReady) throw new Error('Synthetic verified TLS did not start')
  for (const override of [
    ['-e', 'PGHOST=wrong.synthetic.invalid', '-e', 'PGHOSTADDR=127.0.0.1'],
    ['-e', 'PGSSLROOTCERT=/dev/null'],
  ]) {
    let rejected = false
    try { await docker('exec', ...tlsEnvironment, ...override, container, ...tlsQuery) } catch { rejected = true }
    if (!rejected) throw new Error('Synthetic TLS accepted an invalid certificate configuration')
  }
  const packageManager = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
  const migrateArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm --filter @idea-map/server db:migrate']
    : ['--filter', '@idea-map/server', 'db:migrate']
  await run(packageManager, migrateArgs, undefined, { env: { ...process.env, DATABASE_URL: databaseUrl } })
  await sql(source, `CREATE TABLE synthetic_recovery_marker (id text PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()); INSERT INTO synthetic_recovery_marker(id) VALUES ('${marker}-before'); INSERT INTO contacts(normalized_email) VALUES ('${marker}@example.invalid'); INSERT INTO ideas(author_contact_id,publication_state) SELECT id,'approved' FROM contacts WHERE normalized_email='${marker}@example.invalid'`)
  await sql(source, `INSERT INTO idea_revisions(idea_id,version,content,review_state) SELECT i.id,1,'{"title":"Synthetic title","description":"Synthetic description"}'::jsonb,'approved' FROM ideas i JOIN contacts c ON c.id=i.author_contact_id WHERE c.normalized_email='${marker}@example.invalid'; INSERT INTO approved_revisions(idea_id,revision_id) SELECT r.idea_id,r.id FROM idea_revisions r JOIN ideas i ON i.id=r.idea_id JOIN contacts c ON c.id=i.author_contact_id WHERE c.normalized_email='${marker}@example.invalid'`)
  const ideaId = await sql(source, `SELECT i.id FROM ideas i JOIN contacts c ON c.id=i.author_contact_id WHERE c.normalized_email='${marker}@example.invalid'`)
  const revisionId = await sql(source, `SELECT r.id FROM idea_revisions r WHERE r.idea_id='${ideaId}'`)
  const unrelatedIdea = randomUUID()
  await sql(source, `INSERT INTO contacts(normalized_email) VALUES ('${marker}-control@example.invalid');
    INSERT INTO ideas(id,author_contact_id,publication_state)
      SELECT '${unrelatedIdea}',id,'approved' FROM contacts WHERE normalized_email='${marker}-control@example.invalid';
    INSERT INTO idea_revisions(idea_id,version,content,review_state)
      VALUES ('${unrelatedIdea}',1,'{"title":"Synthetic control","description":"Unrelated approved test idea"}'::jsonb,'approved');
    INSERT INTO approved_revisions(idea_id,revision_id)
      SELECT idea_id,id FROM idea_revisions WHERE idea_id='${unrelatedIdea}'`)
  const previewId = await sql(source, `INSERT INTO media_previews(idea_id,revision_id,object_name,generation,content_type,published) VALUES ('${ideaId}','${revisionId}','synthetic-preview','1','image/png',true) RETURNING id`)
  await sql(source, `CREATE ROLE ${reader} NOLOGIN; CREATE ROLE ${runtime} LOGIN PASSWORD 'synthetic-runtime-only'; GRANT EXECUTE ON FUNCTION public.place_legal_hold_outcome(text,text,uuid,text,text) TO ${reader}; UPDATE public_access_gate SET is_open=true WHERE singleton=true`)
  await sql(source, `CREATE ROLE synthetic_default_acl_reader NOLOGIN;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO synthetic_default_acl_reader`)
  const captured = await sql(source, `SELECT extract(epoch FROM recorded_at) * 1000 FROM synthetic_recovery_marker WHERE id='${marker}-before'`)
  const dumpStarted = Date.now()
  let backupAclDigest
  const storage = { bucket: () => ({ async getMetadata() { return [{ name: 'synthetic-private-backups', projectNumber: '123456789', generation: '100', metageneration: '1',
    iamConfiguration: { publicAccessPrevention: 'enforced', uniformBucketLevelAccess: { enabled: true } },
    versioning: { enabled: true }, softDeletePolicy: { retentionDurationSeconds: '604800' } }] },
  file(name) {
    if (name.endsWith('.complete')) {
      const file = { async save(content, options) {
        if (content !== '' || options.preconditionOpts.ifGenerationMatch !== 0 || options.metadata.metadata.daily_generation !== '123' ||
            options.metadata.metadata.backup_version !== '4' ||
            !/^[0-9a-f]{64}$/.test(options.metadata.metadata.source_default_acl_sha256)) throw new Error('Synthetic completion record is invalid')
        backupAclDigest = options.metadata.metadata.source_default_acl_sha256
        file.metadata = { name, bucket: 'synthetic-private-backups', generation: '124', metageneration: '1',
          size: '0', crc32c: 'AAAAAA==', metadata: { ...options.metadata.metadata } }
      } }
      return file
    }
    const file = { createWriteStream(options) {
    if (options.preconditionOpts.ifGenerationMatch !== 0 || options.validation !== 'crc32c') throw new Error('Synthetic upload safeguards missing')
    const stream = createWriteStream(archive, { flags: 'wx', mode: 0o600 })
    stream.once('finish', () => { file.metadata = { name, bucket: 'synthetic-private-backups', generation: '123', metageneration: '1', size: String(stream.bytesWritten), crc32c: 'AAAAAA==' } })
    return stream
  } }
    return file
  } }) }
  const assertSyntheticBackupConnection = childEnv => {
    if (childEnv.PGDATABASE !== source || childEnv.PGHOST !== '127.0.0.1' || childEnv.PGPORT !== port ||
        childEnv.PGUSER !== 'idea_map' || childEnv.PGPASSWORD !== 'synthetic-local-only' ||
        childEnv.PGSSLMODE !== 'verify-full' || childEnv.PGSSLROOTCERT !== 'system') throw new Error('Unexpected synthetic source')
  }
  const startSyntheticDump = (childEnv, snapshotId) => {
    assertSyntheticBackupConnection(childEnv)
    const process = start('docker', ['exec', ...tlsEnvironment, container, 'pg_dump', ...dumpArguments, `--snapshot=${snapshotId}`])
    process.child.stdin.end()
    return process
  }
  const openSyntheticSnapshot = async childEnv => {
    assertSyntheticBackupConnection(childEnv)
    const snapshot = await openBackupSnapshot(childEnv, (command, args, { signal, stdio, windowsHide }) =>
      spawn('docker', ['exec', '-i', ...tlsEnvironment, container, command, ...args], { signal, stdio, windowsHide }))
    try {
      // This commit occurs before pg_dump starts but after the exported snapshot.
      await sql(source, 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT UPDATE ON TABLES TO synthetic_default_acl_reader')
      return snapshot
    } catch (error) {
      await snapshot.close()
      throw error
    }
  }
  await exportEncryptedBackup({ environment: 'dev', bucket: 'synthetic-private-backups', projectNumber: '123456789',
    databaseUrl: `${databaseUrl}?sslmode=verify-full&sslrootcert=system` },
    { start: startSyntheticDump, openSnapshot: openSyntheticSnapshot, storage, now: new Date('2026-11-03T00:00:00Z') })
  if (await sql(source, defaultAclDigestSql) === backupAclDigest) throw new Error('Post-snapshot privilege change was not observed')
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
    file(name) {
      if (!name.startsWith('idea-map-v2/dev/held-material/')) throw new Error('Unexpected synthetic held material')
      const file = { interceptors: [], createWriteStream(options) {
        if (options.preconditionOpts.ifGenerationMatch !== 0 || options.validation !== 'crc32c' || options.metadata?.temporaryHold !== true) throw new Error('Synthetic journal safeguards missing')
        const chunks = []
        return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
          final(callback) {
            if (entries.has(name)) return callback(new Error('Synthetic journal already exists'))
            const body = Buffer.concat(chunks)
            const checksum = new CRC32C()
            checksum.update(body)
            file.metadata = { name, bucket, generation: String(90071992547409931234n + BigInt(entries.size)),
              metageneration: '1', size: String(body.length), contentType: options.metadata?.contentType ?? 'application/json', crc32c: checksum.toString(), temporaryHold: true }
            entries.set(name, { body, metadata: file.metadata })
            callback()
          } })
      }, async getMetadata() {
        const entry = entries.get(name)
        const request = file.interceptors[0]?.request({ uri: '/synthetic', qs: {} })
        if (!entry || request?.qs?.generation !== entry.metadata.generation || request.qs.ifGenerationMatch !== entry.metadata.generation) {
          throw new Error('Unexpected synthetic held metadata')
        }
        return [{ ...entry.metadata }]
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
  // The fixture models a single numbered decision store. Its baseline and
  // writer fence are synthetic and are not independent trust anchors.
  const sequenceTarget = { environment: 'dev', projectNumber: '123456789', secretId: 'synthetic-recovery-sequence', epochId: randomUUID() }
  const sequenceBase = { environment: sequenceTarget.environment, epochId: sequenceTarget.epochId }
  const sequenceFenceNonce = randomUUID()
  const sequenceParent = `projects/${sequenceTarget.projectNumber}/secrets/${sequenceTarget.secretId}`
  const frames = []
  let omitSequenceVersion = false
  let journalUnavailable = false
  const sequenceWriter = { async request(method, path, body) {
    if (method !== 'POST' || path !== `${sequenceParent}:addVersion`) throw new Error('Unexpected synthetic sequence append')
    const bytes = Buffer.from(body.payload.data, 'base64')
    const checksum = new CRC32C(); checksum.update(bytes)
    if (body.payload.dataCrc32c !== String(Buffer.from(checksum.toString(), 'base64').readUInt32BE(0))) throw new Error('Synthetic sequence checksum mismatch')
    frames.push(bytes)
    return { status: 200, data: { name: `${sequenceParent}/versions/${frames.length}`, state: 'ENABLED', clientSpecifiedPayloadChecksum: true } }
  } }
  const sequenceReader = { async request(method, path) {
    const match = new RegExp(`^${sequenceParent}/versions/([1-9][0-9]*):access$`).exec(path)
    if (method !== 'GET' || !match) throw new Error('Unexpected synthetic sequence read')
    if (journalUnavailable) return { status: 503, data: null }
    const version = Number(match[1]), bytes = frames[version - 1]
    if (!bytes || (omitSequenceVersion && version === 2)) return { status: 404, data: null }
    const checksum = new CRC32C(); checksum.update(bytes)
    return { status: 200, data: { name: `${sequenceParent}/versions/${version}`, payload: {
      data: bytes.toString('base64'), dataCrc32c: String(Buffer.from(checksum.toString(), 'base64').readUInt32BE(0)),
    } } }
  } }
  const appendSequence = entry => appendAndVerifyRecoverySequenceVersion(sequenceWriter, sequenceReader, sequenceTarget,
    encodeRecoverySequenceEntry(entry))
  const removalOperation = randomUUID()
  const reviewOperation = randomUUID()
  const manifestArtifact = randomUUID()
  let journaledHoldId
  let committedAuthorityId
  let committedPlacedAt
  let committedAuthority
  let sequenceFenceVersion
  let heldBytes
  let manifestReference
  const authorizedAt = new Date().toISOString()
  const base = { environment: 'dev', ideaId, actorId: director, authorizedAt }
  const previousEmulator = process.env.STORAGE_EMULATOR_HOST
  delete process.env.STORAGE_EMULATOR_HOST
  try {
    const checkpointDigest = 'a'.repeat(64)
    await appendSequence({ ...sequenceBase, kind: 'baseline', checkpointDigest })
    journaledHoldId = await exerciseRemovalRequest(databaseUrl, { ...sequenceTarget, checkpointDigest }, sequenceWriter, sequenceReader,
      { operationId: removalOperation, ideaId, approvedRevisionId: revisionId, classification: 'other', reason: 'synthetic removal' },
      marker, unavailable => { journalUnavailable = unavailable }, async (holdId, coordinatorDatabaseUrl) => {
        if (!/^[0-9a-f-]{36}$/.test(holdId)) throw new Error('Synthetic hold identity is ambiguous')
        committedAuthorityId = await sql(source, `SELECT placement_authority_id FROM legal_holds WHERE id='${holdId}'`)
        committedPlacedAt = await sql(source, `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM legal_holds WHERE id='${holdId}'`)
        committedAuthority = JSON.parse(await sql(source, `SELECT json_build_object('actorId', user_id, 'authority', authority,
          'grantedBy', granted_by, 'grantedAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'authorizationReference', authorization_reference)::text FROM legal_hold_assignments WHERE id='${committedAuthorityId}'`))
        const heldRevision = await sql(source, `SELECT id FROM idea_revisions WHERE idea_id='${ideaId}' AND version=2`)
        const auditId = await sql(source, `INSERT INTO audit_events(idea_id,actor_id,event_type)
          VALUES ('${ideaId}','${director}','synthetic_preservation') RETURNING id`)
        const captureRole = 'synthetic_held_capturer'
        await sql(source, `CREATE ROLE ${captureRole} LOGIN PASSWORD 'synthetic-hold-capture-only';
          GRANT EXECUTE ON FUNCTION public.lock_active_legal_hold_authority(text,text),
            public.read_held_source_selection(text,text,uuid,jsonb),
            public.prepare_journaled_hold_scope_review(text,text,uuid,uuid,jsonb,text,text,text,uuid,text) TO ${captureRole}`)
        if (await sql(source, `SELECT has_table_privilege('${captureRole}','public.idea_revisions','SELECT')`) !== 'f') {
          throw new Error('Synthetic capture role can bypass source selection')
        }
        const captureUrl = new URL(databaseUrl)
        captureUrl.username = captureRole
        captureUrl.password = 'synthetic-hold-capture-only'
        const fixtureEmail = 'synthetic-authority@example.invalid'
        const captureVerifier = {
          async verifySessionCookie(cookie) { return { uid: cookie === 'synthetic-legal' ? marker : 'synthetic-unassigned',
            email: fixtureEmail, email_verified: true, firebase: { sign_in_provider: 'password' } } },
          async getUser(uid) { return { uid, email: fixtureEmail, emailVerified: true, disabled: false } },
        }
        const media = Buffer.from('Synthetic exact preview')
        const mediaChecksum = new CRC32C(); mediaChecksum.update(media)
        const mediaStorage = { bucket(name) {
          if (name !== 'synthetic-private-previews') throw new Error('Unexpected media bucket')
          return { file(object, options) {
            if (object !== 'synthetic-preview' || options.preconditionOpts.ifGenerationMatch !== '1') {
              throw new Error('Exact held source generation was not selected')
            }
            const file = { interceptors: [], async getMetadata() {
              const request = file.interceptors[0]?.request({ uri: '/synthetic', qs: {} })
              if (request?.qs?.generation !== '1') throw new Error('Held source read did not pin its generation')
              return [{ name: object, bucket: name, generation: '1', size: String(media.length), crc32c: mediaChecksum.toString() }]
            }, createReadStream() { return Readable.from([media]) } }
            return file
          } }
        } }
        const selections = [
          { source: { kind: 'revision', sourceId: heldRevision, sourceGeneration: null }, artifactId: randomUUID() },
          { source: { kind: 'related_record', sourceType: 'audit_events', sourceId: auditId, sourceGeneration: null }, artifactId: randomUUID() },
          { source: { kind: 'media', sourceId: previewId, sourceGeneration: '1' }, artifactId: randomUUID() },
        ]
        const capture = (selected, cookie = 'synthetic-legal') => captureAuthorizedHeldInventory(captureUrl.toString(),
          'demo-idea-map', cookie, captureVerifier, { source: mediaStorage, held: journal }, journalTarget,
          { upload: 'synthetic-private-uploads', preview: 'synthetic-private-previews' },
          { holdId, operationId: reviewOperation, manifestArtifactId: manifestArtifact, selections: selected })
        try {
          const listCandidates = (cookie, caseId = holdId) => listAuthorizedHeldSourceCandidates(
            captureUrl.toString(), 'demo-idea-map', cookie, captureVerifier, caseId)
          const deniedInventory = await listCandidates('synthetic-unassigned')
          if (deniedInventory.state !== 'forbidden') throw new Error('Unassigned actor listed held sources')
          let unknownHoldRejected = false
          try { await listCandidates('synthetic-legal', randomUUID()) }
          catch { unknownHoldRejected = true }
          if (!unknownHoldRejected) throw new Error('A missing hold listed candidate sources')
          const candidates = await listCandidates('synthetic-legal')
          if (candidates.state !== 'authorized' || candidates.value.holdId !== holdId || candidates.value.ideaId !== ideaId ||
              candidates.value.sources.some(source => source.sourceId === unrelatedIdea) ||
              selections.some(({ source }) => !candidates.value.sources.some(candidate =>
                candidate.kind === source.kind && candidate.sourceId === source.sourceId &&
                candidate.sourceGeneration === source.sourceGeneration && candidate.sourceType === source.sourceType))) {
            throw new Error('The held source listing differs from the active idea and selected generations')
          }
          const rawCandidates = await runtimeDatabasePool(captureUrl.toString()).query(
            'SELECT body, object_name, object_digest, object_store FROM public.read_held_source_selection($1,$2,$3,NULL)',
            ['firebase:demo-idea-map', marker, holdId],
          )
          if (rawCandidates.rows.length !== candidates.value.sources.length ||
              rawCandidates.rows.some(row => Object.values(row).some(value => value !== null))) {
            throw new Error('The held source listing returned material bytes or storage metadata')
          }
          const denied = await capture(selections, 'synthetic-unassigned')
          if (denied.state !== 'forbidden' || entries.size !== 0) throw new Error('Unassigned actor captured held material')
          let rejectedMissing = false
          try { await capture([{ ...selections[2], source: { ...selections[2].source, sourceGeneration: '2' } }]) }
          catch (error) { rejectedMissing = error.message === 'Held source selection is incomplete' }
          if (!rejectedMissing || entries.size !== 0) throw new Error('An unknown media generation produced held artifacts')
          const captured = await capture(selections)
          if (captured.state !== 'authorized' || captured.value.capturedSources !== selections.length || captured.value.ideaId !== ideaId) {
            throw new Error('Synthetic selected hold capture did not complete')
          }
          manifestReference = captured.value.inventory
          const bytes = await readUnverifiedHeldMaterial(journal, journalTarget, manifestArtifact, manifestReference)
          const { entries: manifestEntries } = decodeUnverifiedHeldManifest(bytes, 'dev')
          heldBytes = manifestEntries.reduce((total, entry) => total + entry.size, 0)
          const capturedRevision = manifestEntries.find(entry => entry.sourceId === heldRevision)
          const artifact = Buffer.from(await readUnverifiedHeldMaterial(journal, journalTarget, capturedRevision.artifactId, capturedRevision))
          if (JSON.parse(artifact.toString()).content?.title !== 'Synthetic later held material') {
            throw new Error('The selected revision did not retain its complete row')
          }
          const review = () => recordJournaledHoldScopeReview(captureUrl.toString(), coordinatorDatabaseUrl,
            'demo-idea-map', 'synthetic-legal', captureVerifier, { ...sequenceTarget, checkpointDigest },
            { writer: sequenceWriter, reader: sequenceReader }, { source: mediaStorage, held: journal }, journalTarget.bucket,
            { upload: 'synthetic-private-uploads', preview: 'synthetic-private-previews' },
            { holdId, operationId: reviewOperation, inventory: manifestReference })
          await sql(source, `UPDATE audit_events SET event_type='synthetic_changed' WHERE id='${auditId}'`)
          let rejectedChanged = false
          try { await review() } catch (error) { rejectedChanged = error.message === 'Held source changed after capture' }
          if (!rejectedChanged || frames.length !== 5 ||
              await sql(source, `SELECT public.lock_idea_for_retention('${ideaId}')`) !== 'f') {
            throw new Error('A changed source accepted a scope review')
          }
          await sql(source, `UPDATE audit_events SET event_type='synthetic_preservation' WHERE id='${auditId}'`)
          for (let attempt = 0; attempt < 2; attempt++) {
            const reviewed = await review()
            if (reviewed.state !== 'authorized' || reviewed.value.state !== 'recorded' ||
                reviewed.value.selectedSources !== selections.length || reviewed.value.holdId !== holdId) {
              throw new Error('Synthetic authorized scope review did not complete')
            }
          }
          if (await sql(source, `SELECT count(*) FROM legal_hold_scope_reviews WHERE operation_id='${reviewOperation}'
            AND confirmation_version>intent_version`) !== '1') throw new Error('Synthetic scope receipt is missing')
        } finally { await runtimeDatabasePool(captureUrl.toString()).end() }
    })
    if (frames.length !== 7) throw new Error('Synthetic requests did not produce one intent and confirmation each')
    sequenceFenceVersion = (await appendSequence({ ...sequenceBase, kind: 'fence', nonce: sequenceFenceNonce })).version
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
  if (await sql(target, defaultAclDigestSql) !== backupAclDigest) throw new Error('Restore default privileges differ from backup snapshot')
  // An older archive can contain an open gate. The replacement is independently
  // isolated before restore, so a runtime identity cannot connect at this point.
  const originallyOpenGate = await sql(target, 'SELECT is_open FROM public.public_access_gate WHERE singleton=true')
  if (originallyOpenGate !== 't') throw new Error('Synthetic archive did not contain an open gate')
  await assertRuntimeFence(target, port)
  // Keep the database gate closed for all subsequent reconciliation. The
  // external fence remains in place and is still required for older schemas.
  const targetClosure = randomUUID()
  const reconcilerRole = 'synthetic_restore_reconciler'
  await sql(target, `UPDATE public.public_access_gate SET is_open=false WHERE singleton=true;
    CREATE ROLE ${reconcilerRole} LOGIN PASSWORD 'synthetic-reconciler-only';
    GRANT CONNECT ON DATABASE ${target} TO ${reconcilerRole};
    GRANT EXECUTE ON FUNCTION public.suppress_restored_removals(uuid[]),
      public.protect_restored_held_ideas(uuid,uuid[]) TO ${reconcilerRole};`)
  if (await sql(target, `SELECT has_table_privilege('${reconcilerRole}','public.restored_hold_protections','DELETE')
        OR has_function_privilege('${reconcilerRole}','public.authorize_journaled_public_access(text,text,text,uuid,text)','EXECUTE')`) !== 'f') {
    throw new Error('Synthetic recovery role can bypass reconciliation')
  }
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
  // Model loss of the ordinary archive after restoration. The held artifacts
  // and decisions must remain independently readable while the target is fenced.
  await rm(archive)
  let summary, recoveryRecords
  const inventoryEmulator = process.env.STORAGE_EMULATOR_HOST
  delete process.env.STORAGE_EMULATOR_HOST
  try {
    const preparedInventory = await readUnverifiedRecoverySequence(sequenceReader, sequenceTarget, sequenceFenceVersion, sequenceFenceNonce)
    if (preparedInventory.coverageVerified !== false || preparedInventory.records.length !== 6) {
      throw new Error('Synthetic sequence inventory failed verification')
    }
    recoveryRecords = preparedInventory.records.map(record => record.payload)
    summary = preparedInventory.summary
    const sequenceHeld = await verifySequenceHeldCaptures(sequenceReader, sequenceTarget, sequenceFenceVersion, sequenceFenceNonce, journal, journalTarget)
    if (sequenceHeld.checkedCaptures !== 0 || sequenceHeld.checkedArtifacts !== 3 || sequenceHeld.checkedScopeInventories !== 1 ||
        sequenceHeld.totalBytes !== heldBytes + manifestReference.size ||
        sequenceHeld.incompletePlacements !== 1 || sequenceHeld.incompleteScopeReviews !== 0 || sequenceHeld.reviewOperations !== 2 || sequenceHeld.unmatchedConfirmations !== 0 ||
        sequenceHeld.coverageVerified !== false || sequenceHeld.authorityVerified !== false) throw new Error('Synthetic sequence held capture failed verification')
  } finally {
    if (inventoryEmulator === undefined) delete process.env.STORAGE_EMULATOR_HOST
    else process.env.STORAGE_EMULATOR_HOST = inventoryEmulator
  }
  const requestPlacement = summary.holdIdentities.find(placement => placement.operationId === journaledHoldId)
  if (summary.coverageVerified !== false || summary.removals.length !== 1 || summary.removals[0] !== ideaId ||
      summary.holdPlacements.length !== 1 || summary.holdPlacements[0] !== ideaId ||
      summary.holdReviewIdeas.length !== 1 || summary.holdReviewIdeas[0] !== ideaId || summary.holdIdentities.length !== 1 ||
      !requestPlacement || requestPlacement.holdId !== journaledHoldId || requestPlacement.ideaId !== ideaId ||
      requestPlacement.placementAuthorityId !== committedAuthorityId || requestPlacement.placedAt !== committedPlacedAt ||
      JSON.stringify(requestPlacement.authorityEvidence) !== JSON.stringify(committedAuthority) || summary.reviewOperations.length !== 2 ||
      !summary.reviewOperations.includes(journaledHoldId) || !summary.reviewOperations.includes(reviewOperation) || summary.unmatchedConfirmations !== 0) {
    throw new Error('Synthetic journal summary failed verification')
  }
  // The target stays isolated. Exercise the real projection and preview queries
  // internally, without opening the gate or claiming complete reconciliation.
  const recoveryPool = new pg.Pool({ connectionString: `postgres://idea_map:synthetic-local-only@127.0.0.1:${port}/${target}`,
    max: 2, connectionTimeoutMillis: 5000 })
  const reconciliationPool = new pg.Pool({ connectionString: `postgres://${reconcilerRole}:synthetic-reconciler-only@127.0.0.1:${port}/${target}`,
    max: 1, connectionTimeoutMillis: 5000 })
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
    await sql(target, `SELECT public.place_independent_access_closure('recovery','${targetClosure}')`)
    if (await sql(target, `SELECT public.inspect_independent_access_closure('recovery','${targetClosure}')`) !== 't') {
      throw new Error('Synthetic recovery closure is missing')
    }
    const removalIntent = recoveryRecords.find(record => {
      const decoded = decodeRecoveryRecord(record, 'dev')
      return decoded.recordType === 'intent' && decoded.operationId === removalOperation
    })
    if (!removalIntent) throw new Error('Synthetic removal intent is missing')
    const coordinatorEmulator = process.env.STORAGE_EMULATOR_HOST
    delete process.env.STORAGE_EMULATOR_HOST
    try {
      omitSequenceVersion = true
      let rejectedMissingVersion = false
      try { await suppressKnownRemovalsFromSequence(sequenceReader, sequenceTarget, sequenceFenceVersion, sequenceFenceNonce, recoveryPool) }
      catch (error) { rejectedMissingVersion = error.message === 'Recovery sequence could not be verified' }
      finally { omitSequenceVersion = false }
      if (!rejectedMissingVersion || (await sql(target, visibleQuery)) !== '1') throw new Error('Synthetic sequence accepted a missing version')
      const previous = { ...sequenceTarget, fenceVersion: sequenceFenceVersion, fenceNonce: sequenceFenceNonce }
      const checkpoint = unverifiedRolloverCheckpoint(previous, frames.map((payload, index) => ({ version: String(index + 1), payload })))
      const next = { ...sequenceTarget, secretId: 'synthetic-recovery-successor', epochId: randomUUID(), fenceVersion: '3', fenceNonce: randomUUID() }
      const nextBase = { environment: next.environment, epochId: next.epochId }
      const nextOperation = randomUUID()
      const nextIntent = encodeRecoveryIntent({ ...base, ideaId: randomUUID(), operationId: nextOperation,
        decision: { kind: 'removal', classification: 'other', reason: 'synthetic uncertain removal' } })
      const nextFrames = [encodeRecoverySequenceEntry({ ...nextBase, kind: 'baseline', checkpointDigest: checkpoint.checkpointDigest }),
        encodeRecoverySequenceEntry({ ...nextBase, kind: 'decision', recordId: nextOperation, data: Buffer.from(nextIntent).toString('base64') }),
        encodeRecoverySequenceEntry({ ...nextBase, kind: 'fence', nonce: next.fenceNonce })].map(payload => Buffer.from(payload))
      const readerFor = (descriptor, source) => ({ async request(method, path) {
        const parent = `projects/${descriptor.projectNumber}/secrets/${descriptor.secretId}`
        const match = new RegExp(`^${parent}/versions/([1-9][0-9]*):access$`).exec(path)
        if (method !== 'GET' || !match) throw new Error('Unexpected synthetic successor read')
        const bytes = source[Number(match[1]) - 1]
        if (!bytes) return { status: 404, data: null }
        const checksum = new CRC32C(); checksum.update(bytes)
        return { status: 200, data: { name: `${parent}/versions/${match[1]}`, payload: {
          data: bytes.toString('base64'), dataCrc32c: String(Buffer.from(checksum.toString(), 'base64').readUInt32BE(0)),
        } } }
      } })
      const nextReader = readerFor(next, nextFrames)
      const rollover = await suppressKnownRemovalsFromRollover(sequenceReader, previous, nextReader, next, recoveryPool)
      if (JSON.stringify(rollover) !== JSON.stringify({ matched: 1, absent: 1, reviewOperations: 3,
        coverageVerified: false, earlierEpochsIncluded: false }) || (await sql(target, visibleQuery)) !== '0') {
        throw new Error('Synthetic rollover did not suppress known removals')
      }
      const heldRollover = await verifyRolloverHeldCaptures(sequenceReader, previous, nextReader, next, journal, journalTarget)
      if (JSON.stringify(heldRollover) !== JSON.stringify({ checkedCaptures: 0, checkedArtifacts: 3, checkedScopeInventories: 1,
        totalBytes: heldBytes + manifestReference.size, incompletePlacements: 1, incompleteScopeReviews: 0, reviewOperations: 3,
        unmatchedConfirmations: 0, coverageVerified: false, authorityVerified: false, earlierEpochsIncluded: false })) {
        throw new Error('Synthetic rollover held-material readback failed')
      }
      await sql(target, `UPDATE ideas SET publication_state='approved' WHERE id='${ideaId}'; UPDATE media_previews SET published=true WHERE id='${previewId}'`)
      const nextCheckpoint = unverifiedRolloverCheckpoint(next, nextFrames.map((payload, index) => ({ version: String(index + 1), payload })))
      const third = { ...next, secretId: 'synthetic-recovery-third', epochId: randomUUID(), fenceVersion: '2', fenceNonce: randomUUID() }
      const thirdBase = { environment: third.environment, epochId: third.epochId }
      const thirdFrames = [encodeRecoverySequenceEntry({ ...thirdBase, kind: 'baseline', checkpointDigest: nextCheckpoint.checkpointDigest }),
        encodeRecoverySequenceEntry({ ...thirdBase, kind: 'fence', nonce: third.fenceNonce })].map(payload => Buffer.from(payload))
      const chain = [{ reader: sequenceReader, descriptor: previous }, { reader: nextReader, descriptor: next },
        { reader: readerFor(third, thirdFrames), descriptor: third }]
      const chainSuppression = await suppressKnownRemovalsFromSequenceChain(chain, recoveryPool)
      if (JSON.stringify(chainSuppression) !== JSON.stringify({ matched: 1, absent: 1, reviewOperations: 3,
        coverageVerified: false, epochCount: 3, earlierEpochsIncluded: false }) || (await sql(target, visibleQuery)) !== '0') {
        throw new Error('Synthetic chain did not suppress known removals')
      }
      const heldChain = await verifySequenceChainHeldCaptures(chain, journal, journalTarget)
      if (JSON.stringify(heldChain) !== JSON.stringify({ checkedCaptures: 0, checkedArtifacts: 3, checkedScopeInventories: 1,
        totalBytes: heldBytes + manifestReference.size, incompletePlacements: 1, incompleteScopeReviews: 0, reviewOperations: 3,
        unmatchedConfirmations: 0, coverageVerified: false, authorityVerified: false, epochCount: 3, earlierEpochsIncluded: false })) {
        throw new Error('Synthetic chain held-material readback failed')
      }
      await sql(target, `UPDATE ideas SET publication_state='approved' WHERE id='${ideaId}'; UPDATE media_previews SET published=true WHERE id='${previewId}'`)
      const restoreJournal = { ...sequenceTarget, checkpointDigest: 'a'.repeat(64) }
      let rejectedWrongClosure = false
      try {
        await reconcileFencedRecoveryFromSequence(sequenceReader, restoreJournal, sequenceFenceVersion,
          sequenceFenceNonce, reconciliationPool, randomUUID())
      } catch (error) { rejectedWrongClosure = error.message === 'Recovery suppression outcome is uncertain' }
      if (!rejectedWrongClosure || await sql(target, visibleQuery) !== '1') throw new Error('Wrong recovery closure partially applied reconciliation')
      const coordinated = await reconcileFencedRecoveryFromSequence(sequenceReader, restoreJournal, sequenceFenceVersion,
        sequenceFenceNonce, reconciliationPool, targetClosure)
      if (coordinated.matched !== 1 || coordinated.absent !== 0 || coordinated.reviewOperations !== 2 || coordinated.coverageVerified !== false ||
          coordinated.holds?.matched !== 1 || coordinated.holds.absent !== 0 ||
          (await sql(target, visibleQuery)) !== '0' ||
          (await sql(target, `SELECT public.lock_idea_for_retention('${ideaId}')`)) !== 'f') {
        throw new Error('Synthetic recovery did not preserve removal and hold restrictions')
      }
      const control = await recoveryPool.connect()
      try {
        if ((await readPublishedIdea('', unrelatedIdea, control))?.title !== 'Synthetic control' ||
            await sql(target, `SELECT public.lock_idea_for_retention('${unrelatedIdea}')`) !== 't') {
          throw new Error('Recovery changed unrelated approved content')
        }
      } finally { control.release() }
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
    if (JSON.stringify(suppressed) !== JSON.stringify({ matched: 1, absent: 0, reviewOperations: 2, coverageVerified: false }) ||
        JSON.stringify(retried) !== JSON.stringify(suppressed)) throw new Error('Synthetic suppression was not idempotent')
    const missingIntent = encodeRecoveryIntent({ ...base, ideaId: randomUUID(), operationId: randomUUID(),
      decision: { kind: 'removal', classification: 'other', reason: 'synthetic uncertain removal' } })
    const withMissing = await suppressUnverifiedRestoredRemovals(recoveryPool, [...recoveryRecords, missingIntent], 'dev')
    if (JSON.stringify(withMissing) !== JSON.stringify({ matched: 1, absent: 1, reviewOperations: 3, coverageVerified: false })) {
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
  } finally { await Promise.all([recoveryPool.end(), reconciliationPool.end()]) }
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
  const sequenceStatusPrivilege = "SELECT has_function_privilege('public','public.pending_sequence_removal_status(text,text,uuid,uuid,text,text,text,text,uuid)','EXECUTE')"
  const restoredSequenceStatusPublicExecute = await sql(target, sequenceStatusPrivilege)
  const confirmationStatusPrivilege = "SELECT has_function_privilege('public','public.pending_sequence_confirmation_status(text,text,uuid,uuid,text,text,timestamptz,uuid,timestamptz,text,text,text,uuid)','EXECUTE')"
  const restoredConfirmationStatusPublicExecute = await sql(target, confirmationStatusPrivilege)
  const verificationTransactionPrivilege = "SELECT has_function_privilege('public','public.protect_pending_verification_transaction()','EXECUTE')"
  const restoredVerificationTransactionPublicExecute = await sql(target, verificationTransactionPrivilege)
  const restoredVerificationTransactionTrigger = await sql(target, "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.public_access_pending_decisions'::regclass AND tgname='protect_pending_verification_transaction' AND NOT tgisinternal AND tgenabled='O'")
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
      restoredSequenceConfirmationPublicExecute !== 'f' || restoredSequenceStatusPublicExecute !== 'f' ||
      restoredConfirmationStatusPublicExecute !== 'f' || restoredVerificationTransactionPublicExecute !== 'f' || restoredVerificationTransactionTrigger !== '1' ||
      restoredPinTriggerPublicExecute !== 'f' || restoredPinTrigger !== '1' || restoredGateOpen !== 'f' || sourceNamedExecute !== 't' || restoredNamedExecute !== 't' || publicConnect !== 'f' || namedConnect !== 'f') throw new Error('Restored synthetic database failed verification')
  const lossMs = Number(latest) - Number(captured)
  if (!Number.isFinite(lossMs) || lossMs < 0) throw new Error('Synthetic data-loss interval could not be measured')
  console.log(JSON.stringify({ backupSeconds: (backupFinished - dumpStarted) / 1000,
    recoverySeconds: (Date.now() - recoveryStarted) / 1000, dataLossSeconds: lossMs / 1000,
    migrations: Number(migrations), postgisRestored: true, syntheticRemovalSuppressed: true,
    journaledRemovalRequestVerified: true, journaledHoldPlacementVerified: true, sourceDefaultPrivilegesMatched: true,
    syntheticPreviewSuppressed: true, restoredHoldBlocksRetention: true, unrelatedIdeaPreserved: true, selectedHeldSourcesCaptured: true, journaledScopeReviewVerified: true, heldEvidenceRequiresReconciliation: true,
    holdAuthorityRequiresReconciliation: true, syntheticArchiveRemovedBeforeReconciliation: true,
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
