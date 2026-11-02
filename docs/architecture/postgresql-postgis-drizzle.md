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
- [Outbox recovery](#outbox-recovery)
- [Consent and retention](#consent-and-retention)

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
request but its response was lost. A caller can attempt `dispatchJob` after the
transaction commits. `reconcileOutbox` makes a bounded repair pass and attempts
each selected job at most once per pass. It claims work with a five-minute lease
and allows five dispatch attempts. Expired leases can be reclaimed; a late
claimant cannot overwrite a newer claim. The application needs a separately
authenticated hourly scheduler and a provider dispatcher to invoke this repair;
the database code does not run a polling loop or configure those services.

`executeJob` locks the job, checks its deadline, and runs a database-only handler
in the same transaction as the final job state. A handler must lock the relevant
domain records and recheck the current revision, assessment, withdrawal and
moderator decision before publishing. It must write publication and projection
intents in that transaction. All domain writers must use compatible locking so a
moderator decision committed first wins. External effects need their own
idempotent delivery; a database transaction cannot make a provider call atomic.
The moderation implementation owns the eligibility checks and the task service
owns authenticated invocation and execution retry limits.

To investigate an unpublished job, an authorized operator can connect to the
intended environment's database with `psql` using its approved read-only role.
Set `job_id` to the known job ID with `\set job_id 'JOB_UUID'` in that session,
then inspect its state:

```sql
SELECT j.id, j.kind, j.state, j.scheduled_at, o.published_at,
       o.dispatch_attempts, o.lease_until
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
