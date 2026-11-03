# Inspect database operations signals

Operators can use the database snapshot to inspect aggregate dispatch backlog,
overdue work, and email delivery events without printing job or message details.
The snapshot is a point-in-time diagnostic; it does not configure monitoring or
alerts. Use an isolated database with synthetic data for testing.

The following contents links navigate within this guide:

- [Prepare the snapshot](#prepare-the-snapshot)
- [Interpret the snapshot](#interpret-the-snapshot)

## Prepare the snapshot

Complete the [development setup](development-guide.md#one-time-setup-for-each-checkout)
and build the workspace with `pnpm build`. The database must have the current
migrations. Provide `OPERATIONS_DATABASE_URL` through an approved secret-handling
method in the command's environment; the command does not load the root `.env`.
Use an already-authorized, read-only database identity with `SELECT` on `jobs`,
`outbox`, and `email_delivery_events`. These table grants also allow direct
access to their rows, so restrict the identity and its credentials accordingly.
Access to a hosted or production database requires separate authorization.

From the repository root, run:

```sh
node apps/worker/dist/operations-snapshot-cli.js
```

The command emits one JSON object and exits successfully, or emits a generic
error and exits nonzero. It uses a read-only transaction, a single database
connection, and a five-second query timeout. It does not print connection
settings, row identifiers, recipients, or message content. Avoid saving output
in public logs; even aggregate activity can be sensitive in a small deployment.

## Interpret the snapshot

`observed_at` is the database transaction time. `backlog.unpublished` counts
pending jobs whose outbox entries have not been acknowledged by the dispatcher,
including future-scheduled jobs. `backlog.exhausted` is the subset with five
dispatch attempts. `backlog.oldest_seconds` is the age of the oldest such
outbox entry, or `null` when there are none.

`overdue.count` counts pending jobs whose scheduled time has passed, whether or
not dispatch was acknowledged. `overdue.oldest_seconds` measures how long the
oldest has been overdue, or is `null` if there are none. These counts do not
prove that a task is missing from the provider or that it is safe to retry.
Investigate using the [task-delivery recovery procedure](../architecture/postgresql-postgis-drizzle.md#outbox-recovery)
before taking action.

The `email` fields count failed, bounced, suppressed, delayed, and complaint
events received during the preceding 24 hours. They count events, not unique
messages, and depend on the webhook receiving and storing provider events. Zero
does not prove delivery or webhook health. Compare provider evidence and
investigate gaps separately.

This snapshot does not measure availability, provider queue age, disk or
storage growth, backup freshness, cost, or alert delivery. It does not run on a
schedule. Before relying on operational monitoring, configure and test those
signals and notifications for the authorized environment and assign an owner.
Query cost and the five-second timeout should be assessed against representative
data volumes and the database connection budget before scheduling collection.
