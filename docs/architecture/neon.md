# Neon architecture

Neon is a managed cloud service for PostgreSQL databases, which store and
retrieve structured application data. Idea Map chooses Neon over Google Cloud
SQL for hosted development and production because its
[scale-to-zero feature](https://neon.com/blog/why-you-want-a-database-that-scales-to-zero)
can suspend database compute when it is idle and resume it when needed. If
you're changing a connection or checking recovery, this guide explains how
environments, pooling, and backups fit together. The
[database guide](postgresql-postgis-drizzle.md) covers schema and migration rules,
and the
[architecture overview](architecture-overview.md#environments-and-recovery)
sets the isolation and recovery requirements.

The following contents links navigate within this guide:

- [Environments and connections](#environments-and-connections)
- [Placement and resilience](#placement-and-resilience)
- [Connection budget](#connection-budget)
    - [Development compute budget](#development-compute-budget)
- [Verify an isolated environment](#verify-an-isolated-environment)
- [Backup and recovery](#backup-and-recovery)

## Environments and connections

Hosted development and production use separate Neon projects and databases.
Development contains synthetic data only. Runtime identities use least-privilege
roles and pooled Transport Layer Security (TLS) connections; schema migration
uses a distinct role and direct connection. Credentials remain in
environment-specific server secrets.

For hosted web traffic, `NUXT_DATABASE_URL` contains the pooled connection
string for the runtime role. `DATABASE_URL` supplies the direct connection for
the migration role to Drizzle; it is not a browser setting. Operators should
obtain each string from the intended Neon project and branch, require TLS, and
avoid placing either string in source control or shared logs. Neon uses
[transaction pooling](https://neon.com/docs/connect/connection-pooling), so
runtime queries must not depend on session state between transactions. The
initial migration creates PostGIS; the migration role needs permission to do so,
or an authorized operator must install it beforehand.

## Placement and resilience

Regional Google services use `us-central1` (Iowa). For Neon, operators should
use `aws-us-east-2` (Ohio) for the development project. Neon projects have a
fixed region, so operators should confirm availability, data residency, transfer
constraints, and measured latency before creating another environment; see
[Neon regions](https://neon.com/docs/introduction/regions). The production Neon
region remains a separate decision.

When you compare regions, you should measure both warm and cold requests,
including cross-cloud round trips, and limit pool sizes and query results. A
nearby region alone does not tell you how long an application request takes.

## Connection budget

The web process keeps a pool of at most two clients for each distinct database
URL. Journaled removal uses a separate one-client pool for each of its
preparation and coordinator URLs, so occupied public readers cannot consume
the reserved connections. Journaled hold placement uses up to two clients
for each of those URLs in its ordinary pools.

For one process per instance, budget up to two clients for public reads, two
additional clients for journaled removal, and four more for hold placement.
With both paths enabled, two instances can use up to 16 clients before
accounting for overlapping revisions or surge. The worker has a one-instance
limit and a pool of at most one client per instance. Include the worker,
operators and replacement revisions in the budget. Request concurrency and
database connections have separate limits.

Operators should calculate capacity separately for each Neon compute and include
all databases, roles, services, processes, pools, direct clients, and concurrent
revisions sharing it. The calculation needs both a client connection budget for
the pooler and a backend connection budget for PostgreSQL. Account for active
and retained idle pooler backend connections, including pools left by earlier
clients, as well as direct clients; reserve slots for migrations, monitoring,
recovery, and other direct connections. Compare the total plus headroom with the
actual `max_connections`, provider-reserved slots, and pooler limits at the
smallest configured compute size. Neon creates separate backend pools per role
and database, which still share the compute's PostgreSQL limit.

Cloud Run's revision maximum is not a hard ceiling: deployments, traffic splits,
replacement instances, and bursts can increase the number of live instances.
Include overlapping revisions and a measured surge allowance in the calculation,
monitor actual instance and connection counts, and revisit the budget whenever
the deployment topology, pool, or compute changes. See
[Cloud Run autoscaling](https://cloud.google.com/run/docs/about-instance-autoscaling).
If the resulting demand or observed load exceeds the available headroom,
operators should lower demand or increase capacity before deployment. The current
limits are starting bounds, not proof that a particular database can support the
workload.

### Development compute budget

The development compute is configured at 0.25 CU. Its planning allocation assumes
`max_connections = 112`, `superuser_reserved_connections = 4`, and
`reserved_connections = 0`; verify these settings after provider or compute
changes. This leaves 108 ordinary PostgreSQL connection slots, before any
provider-specific restrictions. The following allocation covers the whole
compute, including the long-lived development and disposable test databases:

| Allowance | Client or backend connections |
| --- | ---: |
| Web pools, two revisions at two instances with three clients each | 12 |
| Additional web surge, four instances with three clients each | 12 |
| Retained idle pooler backends beyond live web demand | 16 |
| Other development roles and services | 12 |
| Direct migration, monitoring, and recovery clients | 8 |
| Unallocated headroom | 48 |
| Total ordinary PostgreSQL slots | 108 |

The web allowances in this example use three clients per instance. Recalculate
both web rows before enabling journaled removal or hold placement with their
separate roles. The remaining rows reserve PostgreSQL backends. Budget each
client as if it needs a backend, including the
additional retained idle allowance, and count each connection only once. The
worker pool is not separately allocated in this table; recalculate the other
allowances, retained backend connections, and headroom before connecting it.
Neon documents separate pools for each role and database, each with
a `default_pool_size` of 90% of `max_connections`; that per-pool setting does
not reserve slots and does not protect the compute from combined pools. Confirm
the actual pooler limits in the target environment before using this allocation.

These are operating allowances, not enforced quotas. Check all client backends
and pooled server connections across the compute, including idle backends, and
stop an approved test if total client backends reach 50 or any individual
allowance is exceeded. Recalculate the budget before adding roles, processes,
URLs, services, or revisions. Cloud Run can exceed the planned surge allowance,
so operators must monitor actual usage and reduce load if it is approached.
This allocation does not establish a production capacity or a database throughput
limit.

## Verify an isolated environment

Operators can validate connectivity and collect evidence using an approved,
isolated Neon database and a Cloud Run test service with synthetic data. The
environment needs the reviewed runtime and migration roles, a migrated database,
the intended compute and scale settings, and access to provider metrics. Never
use production records for these checks. Provisioning, deployment, and access
changes require separate authorization. The [Neon Cloud Run test procedure](../policies/neon-cloud-run-test-procedure.md)
explains how operators prepare and use the test service.

1. Confirm the application and database regions, compute size, scale-to-zero
    settings, service revision and instance limits, and pool sizes. Record the
    capacity calculation and the allowed direct connections and headroom.
2. Use the direct migration connection to apply the reviewed migrations using
    the [database guide](postgresql-postgis-drizzle.md#schema-and-migration-boundary).
    Through each intended connection, check `SELECT postgis_full_version();`
    and check `SHOW max_connections;` through the direct connection.
3. After the database has actually suspended and the test service has scaled to
    zero, request a synthetic published idea and record end-to-end elapsed time,
    HTTP result, and the observed database and service state. Repeat several
    cold cycles, allowing both to become idle and confirming suspension each
    time; do not label a request cold based only on elapsed idle time.
4. With both components warm, repeat the same request and record the sample
    count, median, high-percentile latency, errors, and timeouts. Record the
    measurement location, date, image revision, compute, workload, and data size
    so the cold and warm results can be compared.
5. Run an approved bounded load including a revision overlap, and compare peak
    instances, pooler clients, backend connections, wait times, and errors with
    the budget. Stop the test if the agreed limits are approached, and record
    observed peaks and any limits that could not be verified.
6. Remove only test-owned synthetic records using the environment's approved
    cleanup procedure, restore temporary settings, and retain the measurements
    without connection strings, credentials, or private data.

These measurements cover the complete request path. Database resume, network,
application startup, pool wait, and query time can all contribute; provider
metrics and separate timings help identify their contributions. An isolated
measurement does not establish production performance or recovery readiness.

## Backup and recovery

The recovery design must meet the application's 24-hour data-loss and downtime
objectives independently of a provider's default restore window. Operators
should verify available restore behavior and rehearse an isolated restore,
including backup retention and removed-content exclusions. Provider recovery
features must not be assumed to replace the application's backup procedure.
Neon history, child and restore-created branches, and manual or scheduled
snapshots can retain older database states independently of the Cloud Storage
exports. Review their actual configuration, access, expiry, and legal holds as
part of the [backup and recovery procedure](../contributor-guides/backup-recovery.md#inspect-retention).
A point-in-time or snapshot restore requires an independent access fence and
reconciliation before it can serve traffic; the older database cannot prove
that later removals and holds were preserved.
