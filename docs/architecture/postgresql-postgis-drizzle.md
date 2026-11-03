# PostgreSQL, PostGIS, and Drizzle architecture

PostgreSQL is a database for storing and querying structured data. PostGIS adds
support for geographic data, and Drizzle is a TypeScript tool for defining and
working with database schemas. Idea Map uses them to store ideas, revisions, and
ownership records. If you're changing how data is stored, this guide explains the
constraints and migration steps that protect those records.

The following contents links navigate within this guide:

- [Schema and migration boundary](#schema-and-migration-boundary)
- [Database verification](#database-verification)
- [Ownership and publication](#ownership-and-publication)
- [Approval history and corrections](#approval-history-and-corrections)
- [Outbox recovery](#outbox-recovery)
- [Consent and retention](#consent-and-retention)
    - [Moderator requests for changes](#moderator-requests-for-changes)

## Schema and migration boundary

PostgreSQL with PostGIS holds the application's authoritative records.

The server-only Drizzle schema lives in `packages/server/src/schema.ts`; the
reviewed SQL migrations and Drizzle journal live in
`packages/server/migrations`. Migration 0000 enables PostGIS, so the migration
role must be allowed to install the extension. Operators should provision the
extension separately where managed PostgreSQL requires it, use a direct
migration connection and a separate least-privilege runtime role, and back up
before destructive changes.

After setting up the pinned tools in the
[development guide](../contributor-guides/development-guide.md), you should set
`DATABASE_URL` to a **non-production** database and run
`pnpm --filter @idea-map/server db:migrate`. Drizzle records applied migrations
and a second run applies only pending changes. You should generate changes with
`pnpm --filter @idea-map/server db:generate --name MIGRATION_NAME`; review
generated SQL, especially extension, custom geography type, foreign-key, and
index ordering, before applying it. Commit the SQL, journal and snapshots
together. `MIGRATION_NAME` is a descriptive lowercase name for the generated
migration. Operators must authorize production migrations separately from local
generation.

## Database verification

You should create a disposable, empty PostgreSQL database with PostGIS
available, name it with the `idea_map_test_` prefix, set `TEST_DATABASE_URL`,
and run `pnpm --filter @idea-map/server test:database`. The test creates tables
and fixtures in that database. You must not point it at shared or production
data because it mutates the target database. It checks initial bootstrap,
upgrading with existing data, rerunning the migrator, ownership constraints, the
guest quota, spatial queries and indexes.

## Ownership and publication

Internal users have stable identifiers and identities are unique by provider and
subject. Contacts and moderation records are private. Ideas default to private
and retain original author contact; an ownership claim can reference only that
contact and only one claim can exist per idea.

A matching email address in the schema does not prove that someone controls that
email. The schema alone also does not link a verified email to an account,
transfer ownership, or authorize reads. The server must verify the email,
atomically claim only unowned submissions, update ownership, and write an audit
event; callers must not treat an email string or an anonymous identity as proof
of ownership. The server must normalize email consistently without
provider-specific alias assumptions.

A verified ownership claim records the matched contact, internal user,
project-specific Firebase identity, and server-recorded verification time in
one transaction with the ownership update and an audit event. The server checks
the current verified account before and immediately before committing the
claim; the external identity provider and database do not share a transaction,
so later trust decisions must verify the account again. Existing claims without
identity evidence remain unverified.

The claim path preserves the email local part, normalizes only the ASCII domain,
and does not collapse provider-specific aliases. It rejects unsupported or
ambiguous input rather than guessing. The database function has a fixed search
path and no `PUBLIC` execute grant; an authorized operator must separately scope
runtime access. Claiming does not alter contact verification, consent, or
publication state.

The ownership-evidence migration leaves existing claims unverified and adds a
unique identity index for its composite foreign key. The index build is not
concurrent, so operators must review write-locking, backups, and rollback before
applying it. Earlier application versions can ignore the additive columns;
operators should preserve newly recorded evidence during rollback.

A composite foreign key prevents an approved-revision pointer from referencing a
revision belonging to another idea. A server transaction must still verify the
revision is approved before setting the pointer and must retain the prior
approved revision during review. Guest counters must be incremented atomically
with durable acceptance; browser identity is an approximate abuse control, not a
person identifier. Jobs and their outbox entries require idempotent handlers and
transactional writes.

The server must enforce the [API policy](../policies/api-policy.md),
[moderation policy](../policies/moderation-policy.md), and
[Privacy Policy](../policies/privacy-policy.md) when reading, publishing, or
deleting stored data.

## Approval history and corrections

Trust history is derived from durable approval records, one per idea, rather
than from a mutable user counter. Approval and its record must be committed in
the same transaction. A later approval updates the revision pointer without
counting the idea twice. Withdrawal does not erase a prior approval; a violation
reversal must be recorded as a correction. Correction changes and their private
actor and reason are committed together, and the caller must enforce moderator
authorization on the server. Reasons must not include submission content.

Before changing an idea's ownership or approval history, lock the affected idea
rows and then the affected user rows in sorted order. A trust decision holds the
same locks through publication. An identity supplied to that decision must come
from verified server-side ownership evidence; an email string alone is not enough.
The current submission and each counted prior approval require a claim tied to
the same internal user's verified identity. The current claim must match the
exact identity and email that the caller has reverified with the provider; the
caller must resolve both the identity and user IDs from that provider result.
Missing or mismatched ownership evidence makes
the trusted shortcut unavailable rather than inventing a history count.
Unverified ownership or unknown history must retain the original standard
deadline. The migration marks backfilled approved pointers as unverified because
it cannot reconstruct prior reversals; an authorized correction can resolve each
record after reviewing evidence. Older approvals without a current pointer cannot
be reconstructed automatically.

These primitives are not a complete moderator workflow. Before enabling them in
production, implement verified ownership and authorized moderator controls,
privacy-safe deletion and the policy's correction-audit retention and legal-hold
rules. All ownership and approval writers must follow the locking protocol.

Moderator authority is stored in `moderator_assignments` for an internal user.
Each assignment records the grant actor and reason and, on revocation, the
revoking actor, time, and reason. A partial unique index permits one active
assignment per user; a database trigger prevents deletion, reinstatement, and
changes other than revocation. These records have user foreign keys, so their
privacy-safe deletion and legal-hold lifecycle must be resolved before live
assignments are enabled.

The server resolves a verified Firebase subject through the project-specific
`firebase:PROJECT_ID` identity namespace. The restricted
`lock_active_moderator(text, text)` function locks the identity and active
assignment until the authorized transaction ends, so a concurrent revocation
cannot commit halfway through an action. The function uses a fixed search path
and has no `PUBLIC` execute grant. After separate authorization, an operator must
grant execute only to the intended runtime role; that role must not be able to
write assignments, modify the function, or create objects in the trusted schema.

Role provisioning, verified identity creation, legal-hold handling, and
privacy-safe removal are not provided by this boundary. Do not grant live roles
or enable automatic publication until those processes and their permissions have
been reviewed and separately authorized.

The role migration adds tables and functions without changing existing identity
or approval records and does not grant runtime access. Older application versions
can ignore the new objects during rollback; operators must preserve assignment
records and review deletion and recovery before removing database objects.

## Outbox recovery

The server records a job and its outbox entry in the same transaction as the
associated domain change. A caller may use `createJobIntent` to make that
change once or `enqueueJob` inside an existing transaction. The idempotency key
identifies an immutable intent; changing its revision, assessment, receipt time,
or schedule under the same key is an error. An assessment job also has a unique
kind, revision, and assessment identity. The caller supplies the policy deadline;
dispatch and replay do not calculate or change it.

An injected dispatcher receives the durable job ID and original schedule. It
must deduplicate task creation by that ID, including when a provider accepted a
request but its response was lost or timed out. The dispatcher must honor its
abort signal. Each call times out after 30 seconds by default, with a configurable
maximum of four minutes, shorter than the dispatch lease; a timed-out request can
still have reached the provider and must be treated as an uncertain delivery.
A caller can attempt `dispatchJob` after the
transaction commits. `reconcileOutbox` makes a bounded repair pass and attempts
each selected job at most once per pass. It claims work with a five-minute lease
and allows five dispatch attempts. Expired leases can be reclaimed; a late
claimant cannot overwrite a newer claim. The application needs a separately
authenticated hourly scheduler and a provider dispatcher to invoke this repair;
the database code does not run a polling loop or configure those services.

An accepted assessment stores its server receipt time, evidence fingerprint,
standard deadline, and jobs in one transaction. A duplicate preserves that
record; a replacement makes its predecessor stale. When a trusted shortcut is
requested, a separate immediate job leaves the standard deadline job intact.
Only the future authorized assessment integration may provide accepted evidence
and policy timing; it must provide a globally unique assessment ID and a digest
of its validated evidence. This storage API does not evaluate a compliance score.
`recordAndDispatchAssessment` reports thrown dispatch failures separately from
unconfirmed attempts. An unconfirmed attempt may be leased by another worker or
already delivered; callers should inspect durable state and provider evidence
before replay rather than treating it as a confirmed failure or success.

`executeJob` locks the job, checks its deadline, and runs a database-only handler
in the same transaction as the final job state. A handler must lock the relevant
domain records and recheck the current revision, assessment, withdrawal and
moderator decision before publishing. It must write publication and projection
intents in that transaction. All domain writers must use compatible locking so a
moderator decision committed first wins. External effects need their own
idempotent delivery; a database transaction cannot make a provider call atomic.
The moderation implementation owns the eligibility checks and the task service
owns authenticated invocation and execution retry limits.

The moderation policy callback must return `retry` when required evidence is
temporarily unavailable. It may return `stale` only when that job is permanently
ineligible; a rejected shortcut leaves its separate standard deadline job intact.
The worker does not expose a way to supply this callback in a request.

To investigate an unpublished job, an authorized operator can connect to the
intended environment's database with `psql` using its approved read-only role.
Set `job_id` to the known job ID with `\set job_id 'JOB_UUID'` in that session,
then inspect its state:

```sql
SELECT j.id, j.kind, j.state, j.scheduled_at, o.published_at,
       o.dispatch_attempts, o.delivery_generation, o.lease_until
FROM jobs j JOIN outbox o ON o.job_id = j.id
WHERE j.id = :'job_id'::uuid;
```

Avoid logging assessments, credentials, or private content. A null
`published_at` with five attempts and no live lease needs investigation; a
published outbox entry only means the dispatcher acknowledged the request, not
that execution succeeded.

Before retrying an exhausted dispatch, check provider delivery and execution
records, confirm that the job remains eligible and that the dispatcher preserves
the same task identity, and coordinate with the recovery owner. After obtaining
authorization for write access, set `job_id` in a `psql` session for that same
environment and run this guarded reset:

```sql
UPDATE outbox SET dispatch_attempts = 0, lease_token = NULL, lease_until = NULL
WHERE job_id = :'job_id'::uuid AND published_at IS NULL AND dispatch_attempts = 5
  AND (lease_until IS NULL OR lease_until <= clock_timestamp())
  AND EXISTS (SELECT 1 FROM jobs WHERE id = outbox.job_id AND state = 'pending')
RETURNING job_id;
```

One returned row means the job can be picked up by the next configured repair
pass. No returned row means the state changed or the job is not eligible; inspect
it again instead of removing the guards. A trusted operator tool can instead
call `retryExhaustedDispatch(pool, jobId)` and `dispatchJob(pool, dispatcher,
jobId)`. Neither reset changes the deadline or execution state. If delivery is
uncertain and task deduplication or execution idempotency cannot be established,
do not replay the job. Record the investigation and escalate instead. These
functions do not provide an operator interface or grant database access.

If a pending job was accepted by the queue but execution exhausted its retries,
or dispatch attempts were exhausted with an uncertain outcome, inspect its
`outbox.delivery_generation` and the corresponding task in the intended queue.
The task name is `job-JOB_UUID-GENERATION`. An authorized operator can use
the worker recovery command after reviewing the intended database, exact queue,
job, generation, execution records, active dispatches, and recovery ownership.
A missing task response does not prove that a previously sent request cannot
still arrive; recently deleted task names can remain reserved. Operators must
establish that replay is safe and that execution is idempotent before proceeding.

From the repository root, the operator should build the worker with
`pnpm exec tsc --build`, configure `WORKER_DATABASE_URL` and `CLOUD_TASKS_QUEUE`
through the approved environment, and use short-lived application-default
credentials with queue inspection access. The operator should then run:

```sh
node apps/worker/dist/recover-cli.js --queue REVIEWED_QUEUE --job JOB_UUID --generation GENERATION --confirm-reviewed-recovery
```

Replace `REVIEWED_QUEUE` with the exact reviewed queue resource name, `JOB_UUID`
with the inspected job, and `GENERATION` with its observed delivery generation.
The supplied queue must also match `CLOUD_TASKS_QUEUE`. Never put credentials in
command arguments or shared logs.

The command checks that the queue exists and matches the reviewed name, then
checks the task. It rearms only if the provider reports the task absent, the
generation is unchanged, the job remains pending, and no dispatch lease is
active. It creates a new delivery generation without changing the job ID or
deadline; a later configured repair pass dispatches it. The `rearmed` result
confirms the database reset, not a new task or successful execution. Results
`present`, `unknown`, or `unchanged` leave the job unchanged; inspect and
escalate rather than bypassing those guards. Operators must preserve idempotency
because a previous in-flight delivery can arrive after the inspection.

For a moderator hold or unavailable eligibility, the moderation job remains
pending and the worker must return a retryable result. If queue retries are
exhausted, an authorized operator follows the same recovery procedure after the
hold or dependency is resolved; the job must not be marked stale just because a
temporary hold or provider failure occurred.

## Consent and retention

Each accepted submission must retain its terms version and server-recorded
acceptance timestamp. The record must survive retries and guest-to-account
claims; an ownership update must not create or replace consent. Referenced terms
versions must remain available for review.

Deletion must honor authorized removal deadlines, legal holds, and backup
expiry. Restore workflows must preserve removal records so deleted content does
not return to public projections. Consent and moderation records must remain
private.

For more background on data and publication, you can read these references:
[data model and ownership](https://github.com/DallasUrbanists/idea-map/wiki/Data-Model-and-Ownership),
[accounts and guest submissions](https://github.com/DallasUrbanists/idea-map/wiki/Accounts-and-Guest-Submissions),
[moderation and publication](https://github.com/DallasUrbanists/idea-map/wiki/Moderation-and-Publication),
[background jobs](https://github.com/DallasUrbanists/idea-map/wiki/Background-Jobs-and-Enrichment).

### Moderator holds

The server-only moderator hold primitive checks the current database assignment
and locks the idea and revision before checking the moderator's assessment
snapshot. It records the actor, time, and reason for placing and releasing a
hold. Publication checks active holds after taking the same idea lock. A hold
continues to block the idea after an edit until explicitly released against the
current review snapshot. It is separate from other review blocks, so releasing
it cannot resolve a rejection or request for changes. Opening a review does not
create a hold.
Assessment, review, and job transactions explicitly use PostgreSQL READ
COMMITTED isolation so a recheck sees changes committed while waiting for locks.
The moderator's current identity is rechecked before commit while the database
assignment remains locked. The external provider and database do not share a
transaction, so this limits but cannot eliminate identity changes at commit.

This primitive does not expose moderator controls or grant database permissions.
Do not enable it for live data until review access, reason handling, privacy,
90-day audit retention, legal holds, deletion, and recovery are implemented and
reviewed. Do not put contacts, raw content, or provider payloads in a reason.
The migration adds a separate table and leaves existing review blocks intact.
Before a rollback to code that does not check this table, disable timed
publication and preserve hold records for review.
Releasing a hold does not itself rearm an exhausted delivery; an authorized
operator must inspect and recover the durable job using the
[outbox recovery procedure](#outbox-recovery).

### Legal holds and decision metadata

Legal-hold authority is separate from moderator assignments. The database
records the Executive Director or a delegate, the non-sensitive authorization
reference, the grantor, and any revocation. A delegate grant must be attributed
to an active Executive Director assignment. Initial authority provisioning and
all permission changes require separate authorized operator review; the
migrations create no live assignments or grants.

A legal-hold record covers one idea and one case. Multiple cases can protect the
same idea independently. Placement and release record the actor, authority,
time, non-sensitive reason and case reference; release can also record a legal
review reference. The authorized operator must determine whether legal review
is required and record its reference before release. The server verifies the
registered identity and checks it again before commit while holding the authority
lock. The provider and database cannot share a transaction, so an identity
change can still occur at commit.
The functions have fixed search paths and no `PUBLIC` execute permission.

Hold placement and the narrow decision-retention primitive lock the idea in the
same transaction. Retention fails closed for missing ideas, active holds, or a
transaction isolation level other than READ COMMITTED. Once permitted, it deletes
only approval/rejection moderation events and approval-correction metadata older
than 90 days; durable approval records remain. It does not remove content,
non-decision events, legal-hold records, accounts, uploads, or backups, and it
is not scheduled or granted to a live role. Any future retention or deletion
writer must take the same idea lock and recheck all applicable holds before its
own changes. An unrecorded hold request must be handled by the operator process
before retention runs.

These primitives do not provide a legal-hold review interface, delegation
administration, complete hold scope, deletion, backup expiry, or restore safety.
The current append-only hold and authority records also prevent deletion of
referenced ideas and users. Their retention and privacy-safe deletion lifecycle
must be decided and implemented before live use. Do not grant live access or
schedule retention based on these tests alone.

### Moderator rejection

A server-verified moderator can reject the current pending revision against the
assessment visible at review time, or against the absence of an assessment.
The decision transaction locks and rechecks the idea, revision, assessment, and
active database assignment. It records the actor, time, reason, revision, and
assessment identity atomically with the rejection. A duplicate or stale action
does not create another event. If an edit is rejected, the prior approved
revision remains public; a rejection committed first makes a timed job stale.
This primitive does not grant permissions, expose controls, or enable automated
publication.

The additive migration leaves older decision events without assessment evidence
and creates a non-concurrent composite index before its foreign key. Review its
write-locking and rollback before applying it to a live database. Decision
metadata and assessment records need a privacy-safe deletion and legal-hold
lifecycle before live use; the new foreign key preserves that dependency rather
than silently deleting the evidence.

### Moderator requests for changes

A server-verified moderator can request changes against the current revision and
assessment, or against the absence of an assessment. The request blocks timed
publication for the idea, including later edits, until a moderator explicitly
resolves it against the current review snapshot. The request and its resolution
record the relevant revision, assessment, actor, time, and reason. Resolving it
never clears a separate moderator hold, rejection, or other review block.

The database functions have fixed search paths and no `PUBLIC` execute grant. A
separate, unscheduled retention primitive removes resolved request metadata only
after 90 days and only when no legal hold applies. Active requests remain to
preserve the block. Neither primitive grants live permissions or provides a
moderator or author interface. Before live use, complete privacy-safe deletion,
legal-hold lifecycle, role administration, notification, recovery, and rollout
review. These records refer to revisions and assessments, so deletion must honor
those dependencies rather than silently discard evidence.
