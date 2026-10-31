# Database schema and migrations

PostgreSQL with PostGIS is authoritative. The server-only Drizzle schema lives in
`packages/server/src/schema.ts`; the reviewed SQL migrations and Drizzle journal
live in `packages/server/migrations`. Migration 0000 enables PostGIS, so the
migration role must be allowed to install the extension. Provision the extension
separately where managed PostgreSQL requires it. Use a direct migration connection
and a separate least-privilege runtime role; back up before destructive changes.

With Node and pnpm versions from the root README installed, set `DATABASE_URL` to
a **non-production** database and run `pnpm --filter @idea-map/server db:migrate`.
Drizzle records applied migrations and a second run applies only pending changes.
Generate changes with `pnpm --filter @idea-map/server db:generate --name NAME`;
review generated SQL, especially extension, custom geography type, foreign-key and
index ordering, before applying it. Commit the SQL, journal and snapshots together.
Deployment migration credentials and production execution are outside this change.

For the integration test, provision a disposable, empty PostgreSQL database with
PostGIS available, name it with the `idea_map_test_` prefix, set `TEST_DATABASE_URL`,
and run `pnpm --filter @idea-map/server test:database`. The test creates tables and
fixtures in that database; never point it at a shared or production database. It
checks initial bootstrap, upgrading with existing data, rerunning the migrator,
ownership constraints, the guest quota, spatial queries and indexes.

Internal users have stable IDs and identities are unique by provider and subject.
Contacts and moderation records are private. Ideas default to private and retain
original author contact; an ownership claim can reference only that contact and
only one claim can exist per idea. The schema alone does not prove email control,
link a verified email to an account, transfer the owner, or authorize reads. The
server must verify the email, atomically claim only unowned submissions, update
ownership and write an audit event; callers must not treat an email string or an
anonymous identity as proof of ownership. Normalize email consistently without
provider-specific alias assumptions.

A composite foreign key prevents an approved-revision pointer from referencing a
revision belonging to another idea. A server transaction must still verify the
revision is approved before setting the pointer and must retain the prior approved
revision during review. Guest counters must be incremented atomically with durable
acceptance; browser identity is an approximate abuse control, not a person ID.
Jobs and their outbox entries require idempotent handlers and transactional writes.
Access control, retention, provider execution and publication policy remain separate
implementation work.

Sources: [data model and ownership](https://github.com/DallasUrbanists/idea-map/wiki/Data-Model-and-Ownership),
[accounts and guest submissions](https://github.com/DallasUrbanists/idea-map/wiki/Accounts-and-Guest-Submissions),
[moderation and publication](https://github.com/DallasUrbanists/idea-map/wiki/Moderation-and-Publication),
[background jobs](https://github.com/DallasUrbanists/idea-map/wiki/Background-Jobs-and-Enrichment).
