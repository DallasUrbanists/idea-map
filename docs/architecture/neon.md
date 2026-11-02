# Neon architecture

Neon hosts Idea Map's PostgreSQL database. If you're changing a connection or
checking recovery, this guide explains how environments, pooling, and backups
fit together. The [database guide](postgresql-postgis-drizzle.md) covers schema
and migration rules, and the
[architecture overview](architecture-overview.md#environments-and-recovery)
sets the isolation and recovery requirements.

The following contents links navigate within this guide:

- [Environments and connections](#environments-and-connections)
- [Placement and resilience](#placement-and-resilience)
- [Backup and recovery](#backup-and-recovery)

## Environments and connections

Hosted development and production use separate Neon projects and databases.
Development contains synthetic data only. Runtime identities use least-privilege
roles and pooled Transport Layer Security (TLS) connections; schema migration
uses a distinct role and direct connection. Credentials remain in
environment-specific server secrets.

## Placement and resilience

Choosing a region means checking end-to-end latency, the time a database takes
to resume, resilience, and data residency. Ohio is a location to evaluate
against other available regions when connecting Google Iowa services; the
location decision remains unresolved until measurements support it.

When you compare regions, you should measure both warm and cold requests,
including cross-cloud round trips, and limit pool sizes and query results. A
nearby region alone does not tell you how long an application request takes.

## Backup and recovery

The recovery design must meet the application's 24-hour data-loss and downtime
objectives independently of a provider's default restore window. Operators
should verify available restore behavior and rehearse an isolated restore,
including backup retention and removed-content exclusions. Provider recovery
features must not be assumed to replace the application's backup procedure.
