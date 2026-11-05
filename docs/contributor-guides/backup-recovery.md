# Back up and recover the database

Operators can export a private database archive and rehearse restoration with
synthetic data.

The following contents links navigate within this guide:

- [When to use this guide](#when-to-use-this-guide)
- [Rehearse with synthetic data](#rehearse-with-synthetic-data)
- [Prepare an encrypted export](#prepare-an-encrypted-export)
- [Prepare the hosted job](#prepare-the-hosted-job)
- [Inspect retention](#inspect-retention)
- [Recover into an isolated environment](#recover-into-an-isolated-environment)

## When to use this guide

Operators can create an encrypted database archive and inspect its retention
inventory. Contributors can rehearse export and restore against a disposable
database. The [architecture overview](../architecture/architecture-overview.md#environments-and-recovery)
sets the recovery objectives and retention requirements.

## Rehearse with synthetic data

Complete the [development setup](development-guide.md#one-time-setup-for-each-checkout)
and start Docker's Linux engine. From the repository root, run:

```sh
pnpm test:recovery-rehearsal
```

The rehearsal creates a uniquely named PostGIS container, binds an automatically
assigned loopback port, and migrates a synthetic database. It uses the parsed
libpq connection fields and a synthetic certificate for its local dump, and checks
that an incorrect hostname and an untrusted certificate are rejected. It does not
test the hosted TLS connection. It streams one
archive through the export pipeline to a local storage fake, then restores it
into a separate empty database. It verifies the synthetic idea, PostGIS, migrations,
and the absence of a record inserted after the snapshot. It also withdraws a
synthetic approved idea, adds a later revision, and places a synthetic legal
hold after the export. The older isolated restore still contains the previously
public state and lacks the later hold, revision, actor, and legal-authority
assignment. The rehearsal runs the removal coordinator against a synthetic
moderator and an in-memory numbered sequence, then appends synthetic hold
records and captures the committed hold's ID. The coordinator uses a local
database administrator and fake identity and journal services; this does not
verify hosted grants or complete journal coverage. It reads each version
through a selected fence, rejects a deliberately missing version, identifies the
synthetic idea for hold review, and uses the suppression primitive
for the known removal in the isolated restore. It also stores and reads back one
synthetic title from the later revision as a bounded held-material artifact. Its
fake upload checks the temporary-hold request and response, and readback checks
the synthetic hold before and after download. It does not prove that a hosted
hold persists or can be released safely. A
synthetic manifest links that artifact to the hold and is itself referenced by a
version-three confirmation; the rehearsal verifies the selected exact generation
and digest. That single value is not a complete hold scope or a
reconstruction of the revision.
It verifies that an open gate
blocks suppression and that a retry is idempotent. With
the gate still closed, it checks
the existing internal idea and preview reads before and after suppression; the
preview uses synthetic bytes from a fake storage client. These checks do not test
the hosted delivery path or caches. The rehearsal does not prove journal coverage,
reapply the hold, reconstruct its authority, or preserve all held material. The
service must stay isolated until those remaining decisions and evidence are
reconciled. The rehearsal
first confirms that restoring without a required
synthetic role fails, then prepares that role and restores to another database.
It checks that one protected security-definer function retains its synthetic
named-role grant and `PUBLIC` revocation in the restore. The fake
stores only synthetic data and does not test Cloud Storage encryption or
permissions, all database grants, or Neon role setup. The archive deliberately
contains an open public-access gate. Before restore, the synthetic target revokes
`PUBLIC` database connections; after restore, the test verifies that a synthetic
runtime login cannot connect, then closes the restored gate while the target
remains isolated. A second synthetic archive omits the gate table; its restored
target also rejects the runtime login, and the current lease code rejects the
missing table. That fixture is not a full historical schema and does not verify
compatibility with a particular earlier release. The rehearsal checks that the
restored pending-removal preparation, application, confirmation, verification, and
recovery-suppression functions do not grant `PUBLIC` execution and that the guard
triggers are enabled without `PUBLIC` execution. It
does not show that an older archive contains a later gate closure. These checks
do not establish a hosted network or IAM fence.

The rehearsal records the synthetic hold's committed assignment facts and exact
placement time in a version-three confirmation. These facts do not authenticate
the person or written delegation, recreate missing referenced rows, or preserve
held content. The sequence's baseline and fence are synthetic fixtures, not
independently protected evidence, and do not establish coverage.

The JSON result reports backup and recovery elapsed seconds, the interval between
the saved and later synthetic records, and verification results. Recovery starts before the empty
target is created and ends after database checks. The interval measures only the
test records, not the worst possible loss between scheduled backups. This local
test uses one container and a storage fake: it does not verify replacement
infrastructure, cloud permissions, retention, deleted-content reconciliation,
or the 24-hour objectives for the deployed service.

The script deletes its own labeled container, anonymous volume, and temporary
synthetic archive. If interrupted, inspect containers with the
`idea-map.recovery-test` label and remove only the container belonging to the
interrupted run; investigate before removing any unrecognized resource. Stop
and check this checkout's development services using the
[shutdown steps](development-guide.md#end-of-each-work-session).

## Prepare an encrypted export

Use only an explicitly authorized environment and identity. Before using the
command, operators must establish a reviewed schedule and alerts, retention and
deletion process, and an isolated restore rehearsal.
Those deployment controls are separate from the export command. Do not use this
command as the sole live backup until those controls are in place and tested.

The runtime needs Node, `pg_dump`, the built shared server package, the worker
package's Cloud Storage client, and Application Default Credentials. When
running from a checkout, build the shared package first with
`pnpm exec tsc --build packages/server` from the repository root. The backup
image includes the built package. Use a `pg_dump` version compatible with the
source PostgreSQL version and a direct
database connection. The archive preserves access grants and revocations but
the restore omits original object owners. Prepare the reviewed roles referenced
by the archive before restoring, and stop on missing roles or grant errors.
Security-definer functions can run with the restore owner's authority. Keep all
application identities out of the replacement until reviewed function
ownership, revocations, grants, and default privileges have been applied and
tested. Do not use `--no-acl`: it omits revocations and can give `PUBLIC`
execute access to restored functions. Account for the export's
direct database connection in the existing connection limits before scheduling it.
Use the environment's foundation-owned backup bucket and Terraform state;
do not create a second backup bucket or database for this exporter. A bucket
definition does not establish that it has been provisioned. Daily
scheduling alone does not prove the 24-hour data-loss target when a run is
delayed or fails.

Provide these values through the runtime's approved configuration and secret
mechanism. The command does not load the root `.env`.
The real export and inventory commands refuse `STORAGE_EMULATOR_HOST`; use the
separate synthetic rehearsal or provider fake for local tests.

| Variable | Meaning |
| --- | --- |
| `BACKUP_ENVIRONMENT` | `dev` or `prod`, matching the separately reviewed environment. |
| `BACKUP_BUCKET` | Bare name of the existing environment's private backup bucket. |
| `BACKUP_PROJECT_NUMBER` | Decimal project number that owns that bucket. |
| `BACKUP_DATABASE_URL` | Secret direct Neon PostgreSQL URL with `sslmode=verify-full` and `sslrootcert=system`. |

Specify the database, one unescaped DNS or IP host, port, user, and password in
the URL's main connection fields. The exporter rejects encoded hosts, Unix
socket paths, host lists, pooled endpoints, and query parameters that override
those fields. It accepts only `sslmode`, `sslrootcert`, an optional
`gssencmode=disable`, and an optional `channel_binding=require` or `prefer`;
it rejects duplicate settings and URL fragments. The exporter decodes the URL
and passes its connection fields to `pg_dump` as separate libpq environment
variables, keeping credentials out of command arguments. It disables GSS
encryption for the dump so [libpq](https://www.postgresql.org/docs/current/libpq-connect.html)
uses the required certificate-verified TLS instead. Verify the intended
project, branch, role, and database separately; URL validation does not prove
their identity.

The exporter checks the bucket's project number, enforced public-access
prevention, uniform access, versioning, Google-managed default encryption, and a
seven-day soft-delete period. It refuses disabled soft delete because inventory
cannot list generations retained under an earlier policy. It also refuses a
bucket-wide default hold or retention policy, hierarchical namespace, a
customer-managed default key, lifecycle rules that delete objects, or actions
it cannot identify. A default
hold or retention policy could retain unrelated people's data too long, and
hierarchical namespace does not support the separately scoped object holds.
Age-based deletion cannot protect the
required backup counts.
It does not verify inherited IAM permissions, bucket ownership by
another Terraform state, past lifecycle rules, legal holds, or the effective
deletion deadline. [Cloud Storage can continue applying a previous lifecycle
configuration](https://cloud.google.com/storage/docs/lifecycle) for up to 24
hours after a change; review its history separately.
The export identity needs the database read access
required for a complete dump, bucket metadata read access, and object creation
access. It must not have object update or backup deletion rights: object update
can release holds. Review inherited permissions separately. The runtime needs a working
system certificate bundle to verify Neon. Test that connection against an
isolated Neon database before enabling an export.

For a synthetic development database, an authorized operator can create an
archive from the repository root:

```sh
node apps/worker/ops/export-encrypted-backup.mjs
```

The command streams one dump directly to a daily object and, on Mondays in UTC,
to a matching weekly object. Uploads use HTTPS, create-only preconditions, and
CRC32C integrity checks.
[Cloud Storage encrypts stored data at rest](https://cloud.google.com/storage/docs/encryption/default-keys)
using its managed keys. No production dump may pass through a local machine;
production export runs only in an authorized hosted job. The command checks
for Cloud Run job environment variables, but those values are not proof of
the runtime or identity; verify both separately. The command emits a
start timestamp and object names on success. The timestamp precedes the dump and
is a conservative freshness reference. A nonzero dump exit or any dump warning
fails the export; the command does not log diagnostic text because it can
contain sensitive information. Investigate warnings through an authorized
private procedure. If either Monday upload fails, the run
fails; a completed copy may remain and must be investigated rather than assumed
to make the other copy complete. Treat an ambiguous upload as unverified.
After all required objects pass their upload checks, the exporter creates one
zero-byte completion record with the archive generations, sizes, and checksums.
The record uses a create-only precondition and requires no update to existing
objects. The exporter checks the returned marker identity, empty-object checksum,
and exact completion metadata before reporting success. A failed or ambiguous
response can still leave a marker behind; review it through the authorized
inventory process. The inventory refuses archives without a matching record,
and weekly copies whose size or checksum differs from the daily copy. The record
confirms the export finished; CRC32C detects accidental corruption, not
malicious alteration. Only a restore test verifies that an archive is usable.
On an upload checksum mismatch, the Storage client attempts to delete the object.
The intended create-only backup writer lacks delete permission, so the attempt
must fail and the unconfirmed object can remain for separately authorized review
and cleanup. Verify effective permissions before relying on this boundary.
Bucket metadata and completion-record requests each have a 15-second wait
limit. The limit does not cancel an SDK request already in flight; it can still
finish after the exporter reports failure. Review the outcome before retrying.
The dump and uploads share a 30-minute transfer limit that stops the child and
destroys the streams on timeout. Provider requests can still finish ambiguously;
the separate hosted job timeout remains necessary.
If an entire week's copy is missing, an authorized operator can rerun the
command with `--weekly` to write both classes from one new snapshot. This does
not reconstruct an earlier point in time.

## Prepare the hosted job

The existing foundation can optionally define a Cloud Run job and a Cloud
Scheduler trigger for exports. The option starts disabled, and the scheduler
starts paused. The job uses the foundation-owned backup bucket and state; it
does not create a second backup bucket, database, or secret. Confirm whether the
foundation bucket already exists and review the complete plan for duplicate
media buckets before any apply. Review existing resources
and complete the release and infrastructure prerequisites before a separately
authorized plan or apply.

The job requires the backup bucket to be managed by the owning foundation. A
development release rehearsal that omits media buckets can separately opt in
to `manage_backup_bucket_separately` with a distinct reviewed backup bucket
name. This uses the same foundation resource address as the full configuration;
it does not manage the staging media buckets or grant access to a bucket owned
by another state. Check existing resources and state ownership before any plan
or apply. The foundation explicitly sets seven-day soft delete on its backup
bucket; review the actual setting and previous policies before any change,
because already soft-deleted generations retain their original expiry. Creating
a missing bucket or changing its policy requires separate authorization.

Prepare an immutable backup image and a dedicated direct database URL secret.
The image's `pg_dump` major version must support the actual source server;
verify the source version separately for each environment. The URL must use
the TLS settings above and an identity with the access needed for a complete
dump. Pin a numeric secret version. Secret Manager grants access at the secret
level, so the job identity can access other versions of that secret even though
the job references one version. Do not reuse web or worker credentials.

Set `enable_backup_job`, `backup_job_image`, `backup_project_number`,
`backup_database_secret_id`, `backup_database_secret_version`, and the reviewed
UTC `backup_schedule` in the foundation configuration. Put no secret values in
Terraform variables or state files. Review the plan for the intended job,
bucket grant, dedicated identities, secret grant, and paused scheduler. The
custom role grants bucket metadata read and creation in the daily, weekly, and
completion prefixes only. Inspect inherited permissions and deny policies, and
verify the prefix conditions with synthetic objects. Confirm the effective
identity cannot write held-material objects, access the decision secret, update
or delete objects, or release holds.

The job uses one task, no automatic retries, and a bounded execution timeout.
The supported cron schedules run at a fixed minute every day, or at an evenly
spaced interval of one, two, three, four, six, eight, or twelve hours in UTC.
One task per execution does not prevent two executions from overlapping. Limit
and serialize manual and scheduled invocations, account for direct database
connections, and verify failure alerts and missed-run recovery before any
separately reviewed change unpauses the scheduler. The schedule must support the
24-hour objective even when a run is late or fails; a daily cron alone is not
proof. The UTC schedule must also include Monday runs for weekly copies. Do not
enable live exports until retention, held data, independent recovery records,
and an isolated restore have been reviewed and verified.

The same foundation can separately enable `enable_backup_failure_alert` for
exporter-reported failures and `enable_backup_freshness_alert` for missing
completed-export signals. Both use existing reviewed
`monitoring_notification_channels` and start disabled. For freshness, set
`backup_freshness_seconds` to a reviewed whole-minute absence window. Choose an
export schedule and alert window that leave room for a failed run, the job's
maximum duration, detection and provider delays, and a response before the
data-loss objective is exceeded. The alert window must exceed the interval
between scheduled runs plus the 35-minute job timeout; because the maximum
window is 23.5 hours, a daily schedule cannot be paired with this alert. This
minimum does not account for provider delay or prove the data-loss objective.

The freshness metric begins collecting after it is created and needs a first
successful measurement before an absence alert can fire. A deleted or shut-down
resource, startup failure, missing log data, or unavailable notification channel
can prevent or delay a notification; delayed logs can also cause false alerts.
Review who can write matching log entries: the signal is not tamper-proof.
Verify the first signal and the job and scheduler independently, then test
failure, missed-run, recovery, and notification behavior in an authorized
isolated environment. These alerts do not check archive retention, legal holds,
restorability, or the age of the actual database snapshot. Continue inventory
and restore checks separately.

## Inspect retention

The retention inventory uses the worker package's Cloud Storage client and
Application Default Credentials. Verify the identity and environment before
use. The inventory identity needs bucket metadata and object listing access.
With `BACKUP_ENVIRONMENT`, `BACKUP_BUCKET`, and
`BACKUP_PROJECT_NUMBER` configured, run:

```sh
pnpm exec tsc --build packages/server
node apps/worker/ops/inspect-backup-retention.mjs
```

The command lists live and noncurrent versions and, separately, soft-deleted
objects under the daily, weekly, and completion prefixes. The inventory fails
when soft delete is disabled: previously soft-deleted objects can remain
recoverable under their [original policy](https://cloud.google.com/storage/docs/use-soft-delete).
The [soft-deleted listing](https://cloud.google.com/storage/docs/json_api/v1/objects/list)
requires an enabled policy. Review the bucket's policy history and retained
objects separately. It does not inspect the recovery journal. It reports older
noncurrent versions awaiting deletion and
fails if a recent backup unexpectedly becomes noncurrent. It produces a plan,
never deletes an object, and fails on incomplete,
unexpected, or ambiguous inventories. Each prefix and listing mode is limited to
100 pages of up to 1,000 objects; exceeding that limit fails the inventory for
review. The command repeats both listing modes and checks the bucket generation
and metadata generation again, failing if the observed inventory changes.
Matching listings do not prove that no objects were missed, stop writers or
lifecycle actions, or make a later deletion safe. Independently fence those
changes and revalidate any generation immediately before an authorized action.
Bucket verification and all listings share a 60-second deadline.
The deadline stops waiting but does not cancel a storage SDK request already in
flight; monitor stalled requests and process termination separately. The plan
retains all copies in the latest
14 daily dates and eight weekly periods, requires those periods to be consecutive,
and applies additional
15-day and 63-day minimum ages, and excludes held objects. It reports old or
held objects and old soft-deleted objects for investigation. Completion records
can outlive their live and noncurrent archives: the inventory reports them as
`orphanCompletions` and never counts them as backups. The archives can still be
soft-deleted. A record that becomes noncurrent while an associated archive
generation remains, including soft-deleted generations, is an error. Fewer than 14 daily
dates or eight weeks, or a gap in those recent periods, sets `retentionSatisfied`
to false, proposes no deletions, and causes the command to exit nonzero. The
output still reports the distinct period counts and freshness during initial
backup accumulation. `privacyDeadlineVerified` is always false: the inventory
does not establish that copies of removed content expired by their deadline.
`latestDailyAgeSeconds` and `latestWeeklyAgeSeconds`
measure the ages of the latest confirmed exports from their conservative start
times. `dailyFreshEnough` and `weeklyFreshEnough` are false when the respective
export is absent or older than 24 hours or seven days. The command then proposes
no candidates and exits nonzero. These conservative limits can signal a gap
during a delayed run. This diagnostic does not schedule checks or send alerts.
A lower-level planner also suppresses candidates when even the latest upload
completion is too old; that check alone cannot establish backup freshness. The
inventory additionally checks the recorded backup start time and completion.
A fresh export alone does not prove that the deployed service meets its data-loss
objective.

`reviewRequired` is true when a live archive is old or held, or an old archive
remains noncurrent or soft-deleted; the command exits nonzero in that case.
`oldPendingArchives` identifies old noncurrent archives separately from
`oldSoftDeleted`. `longSoftDelete` counts generations whose original soft-delete
period exceeds seven days; `overdueSoftDeletion` counts generations still listed
after their reported hard-delete time. Either requires review, even if the
current bucket policy is shorter. These conservative signals require
investigation; they do not prove that a particular archive violates a removal
deadline or that a hold is
unauthorized. A valid hold still requires separately scoped retention review.

The plan is a point-in-time observation, not permission to delete. It cannot
serialize other operators or detect an independently missing or invalid archive.
Before any separately authorized cleanup, serialize all backup and retention
operations, re-list every generation and hold, and review the exact generation
and metageneration preconditions. Retain a completion record while any of its
archive generations remain; review orphan records separately after their
archives have expired. Cloud Storage lifecycle deletion is
asynchronous; versioning, soft delete, object holds, and legal holds can extend
retention. Monitor and verify actual expiration against the
[Privacy Policy](../policies/privacy-policy.md#retention-and-deletion); an age
rule or a missing live object alone does not prove that backup copies expired.
Holding a whole database archive for one person's legal hold can also retain
other people's data beyond its deletion deadline. Resolve how held records are
preserved separately and verify expiration of all other copies before enabling
automated retention or relying on this process for live data.
Target deletion of primary copies within 14 days of an authorized removal. With
a 63-day minimum weekly archive age and a seven-day soft-delete period, an
archive taken just before primary deletion could remain recoverable for about
84 days. That leaves roughly six days for cleanup and provider delays; missed
backups, holds, longer past soft-delete policies, or failed cleanup can exceed
the 90-day deadline.

The inventory flags live archives whose earliest possible start was at least
69 days ago as `expiryAttention`, and reports noncurrent and soft-deleted
archives of that age separately as
`expiryAttentionPending` and `expiryAttentionSoftDeleted`. It uses midnight UTC
on the validated archive date as the earliest possible start, so an alert may
appear before the archive reaches that age. Those counts give operators an early
point to review whether affected copies can expire before their deadlines. They
do not identify which archives contain a removed item or prove that primary
deletion met its 14-day target. The actual process must account for each
removal's authorization time and verify when every affected copy becomes
unrecoverable. Treating this diagnostic as an automatic age-only
deletion policy can violate the privacy policy.
Age-based lifecycle rules alone cannot guarantee the required number of
successful backups after failed runs. A deletion process must account for both
the minimum backup counts and the privacy deadline, and independently verify
old versions, soft-deleted objects, and actual expiration.

The Cloud Storage inventory does not cover Neon history, branches, or snapshots.
For each separately authorized environment, an operator must also review the
configured [history window](https://neon.com/docs/postgres/backup-restore/history-window),
the [branch hierarchy](https://neon.com/docs/manage/branches), and the
[backup and restore inventory](https://neon.com/docs/guides/backup-restore).
Include child branches, old branches created by restores, manual snapshots, and
scheduled snapshots. A child branch can retain its earlier data after the parent
changes. Manual snapshots do not expire unless an expiration is configured, and
the provider can preserve the latest scheduled snapshot while its schedule is
active. API- or CLI-created branches may have no expiration. Review the actual
environment rather than assuming provider defaults.

For an authorized removal, record which provider-held recovery points may still
contain the material, their owners and expected expiry, and any applicable hold.
Confirm the provider's actual deletion and retention behavior for those copies;
a shorter history window or an inaccessible branch alone is not evidence that
every retained copy has expired. Keep unknown copies and delayed provider
deletion as unresolved risks against the 90-day deadline. Coordinate scoped
hold preservation with #56 before changing or deleting a recovery point. Review
the effect on other records, dependent branches, and recovery objectives, and
obtain the required authorization before any provider change. This review does
not authorize deletion of a branch or snapshot.

## Recover into an isolated environment

An authorized recovery owner should identify the incident time, last verified
archive, current removal and legal-hold records, compatible image and schema,
access, and a replacement target. Preserve the source, evidence, and all newer
records; never restore over a live database. Stop external writes and delivery
while recovering, and use separate test data and identities for a rehearsal.

Restore only into a new isolated Neon database with compatible PostgreSQL and
PostGIS. Hosted development uses synthetic data only; keep production backups
and restored production records within separately controlled production recovery
resources, not the development project or a local machine.
Fence network and application access independently before creating the target,
restrict database connections, and verify effective inherited access. Fence the
original writers and drain in-flight work before inventorying decision records;
follow the [journal fence procedure](../architecture/recovery-journal.md#write-and-reconcile)
and account for delayed permission propagation. An older
archive cannot be trusted to contain a later publication gate or removal.
The same rule applies to a Neon point-in-time restore or snapshot. A one-step
restore can replace the current branch while preserving its endpoint, so fence
public access and writers independently before invoking it; an older database
gate cannot provide that fence. Account for any backup branch created by the
restore when verifying subsequent retention and deletion.
Verify archive integrity before using it, and use `pg_restore`
with error checking. Prepare restricted database roles before restoring ACLs,
then verify function ownership and execute permissions for `PUBLIC` and each
runtime role, including security-definer functions. Check migrations,
representative records, outbox and queue state, and
application behavior. Reconcile removals, withdrawals, holds, and any newer
durable events from an independent authoritative source before allowing public
reads or replaying side effects. If that source is unavailable, keep the
replacement isolated and escalate; an older database backup can contain content
that was subsequently removed.
Pausing a scheduler does not cancel a request already in flight. Drain and
inspect those requests before deciding which delivery work to recover. Rearming
an outbox generation requires the separately authorized operator connection in
the [outbox recovery procedure](../architecture/postgresql-postgis-drizzle.md#outbox-recovery);
the restricted staging worker role cannot do it. Do not widen that runtime role
to make a restore proceed.
The project does not currently implement an independent authoritative record for
those later changes. The [recovery decision journal design](../architecture/recovery-journal.md)
describes the required record and unresolved safeguards. This procedure cannot by
itself establish that a restored service is safe to return to public use.

For a separately authorized synthetic rehearsal, prepare a private working
directory on the recovery host, a fresh archive path, and an empty isolated
database. Confirm the target does not already contain schemas or extension
objects also present in the archive. For example, the local PostGIS image's
default database already contains a `tiger` schema and is not an empty restore
target. For local PostgreSQL tests, create a separate database from `template0`;
verify the hosted provider's target separately. Set
`RECOVERY_OBJECT` to the reviewed `gs://` object name,
`RECOVERY_GENERATION` to its exact decimal generation, `RECOVERY_ARCHIVE` to the
fresh local path, and `RECOVERY_DB_NAME` to the test database name. Configure
the direct connection with libpq environment variables and a protected password
file; do not put credentials in command arguments. Verify the selected
completion record matches the object generation, size, and CRC32C before
downloading. In a Bash shell on the authorized recovery host, run the following
commands and stop if any command fails. The first check refuses an existing
archive path.

```sh
umask 077
test ! -e "$RECOVERY_ARCHIVE" && gcloud storage cp "${RECOVERY_OBJECT}#${RECOVERY_GENERATION}" "$RECOVERY_ARCHIVE"
gcloud storage hash --skip-md5 "$RECOVERY_ARCHIVE"
```

Compare the reported CRC32C with the reviewed completion record and stop on any
mismatch. Cloud Storage also checks integrity during download. Verify the target
and connection again, then inspect and restore the trusted archive:

```sh
pg_restore --list "$RECOVERY_ARCHIVE"
pg_restore --exit-on-error --no-owner --dbname "$RECOVERY_DB_NAME" "$RECOVERY_ARCHIVE"
```

Archive listings can contain sensitive names. Do not send them to public logs.
The restore can execute code from the archive and a failure can leave a partial
database, so use only a trusted archive and retain the isolation on failure.
Dispose of the temporary archive according to the environment's approved
procedure. For production, run recovery only inside the separately controlled
production recovery environment; do not download its data to a local machine.

Record the last recoverable data time and incident time to measure data loss,
and the incident start and verified service restoration time to measure recovery.
Include replacement infrastructure, access, permissions, migration,
reconciliation, and validation in the elapsed time. The release operator should
follow the [Cloud Run rollback procedure](cloud-run-release.md#roll-back-or-recover-an-interrupted-operation)
for an authorized code rollback and check database compatibility before routing
traffic. Database compatibility alone is not enough: a previous web revision
may not enforce the public access gate, and a previous writer may bypass the
recovery journal. Before routing traffic or resuming jobs, verify that every
serving and mutation revision enforces the reviewed recovery boundaries. If it
does not, keep public access and affected writers independently fenced until an
authorized recovery process restores those protections. The release workflow's
revision and health checks do not establish journal coverage or gate enforcement.
A local restore result does not establish either production objective.
