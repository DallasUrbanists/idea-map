# PostgreSQL, PostGIS, and Drizzle architecture

Ideas, revisions, and ownership records live in PostgreSQL, with PostGIS handling
spatial data and Drizzle describing the schema. If you're changing how data is
stored, this guide explains the constraints and migration steps that protect
those records.

The following contents links navigate within this guide:

- [Schema and migration boundary](#schema-and-migration-boundary)
- [Database verification](#database-verification)
- [Ownership and publication](#ownership-and-publication)
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
