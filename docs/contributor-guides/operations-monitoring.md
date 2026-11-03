# Inspect operations signals

Operators can inspect aggregate database and queue activity without exposing
job or message details.

The following contents links navigate within this guide:

- [When to use this guide](#when-to-use-this-guide)
- [Prepare the snapshot](#prepare-the-snapshot)
- [Interpret the snapshot](#interpret-the-snapshot)
- [Inspect the provider queue](#inspect-the-provider-queue)
- [Prepare scheduled collection](#prepare-scheduled-collection)
- [Inspect provider metrics](#inspect-provider-metrics)

## When to use this guide

Operators can inspect aggregate dispatch backlog, overdue work, email delivery
events, public-access gate state, and provider queue age without printing job or
message details. These snapshots are point-in-time diagnostics; they do not
configure monitoring or alerts. Use isolated resources and synthetic data for testing.

## Prepare the snapshot

Complete the [development setup](development-guide.md#one-time-setup-for-each-checkout)
and build the workspace with `pnpm build`. The database must have the current
migrations. Provide `OPERATIONS_DATABASE_URL` through an approved secret-handling
method in the command's environment; the command does not load the root `.env`.
Use an already-authorized, read-only database identity with `SELECT` on only
the columns needed by the snapshot: `jobs.id`, `jobs.state`,
`jobs.scheduled_at`; `outbox.job_id`, `outbox.published_at`,
`outbox.dispatch_attempts`, `outbox.created_at`; and
`email_delivery_events.event_type`, `email_delivery_events.created_at`; and
`public_access_gate.singleton`, `public_access_gate.is_open`. It also
needs schema usage. These grants allow direct access to those individual column
values, including job IDs and timing, so restrict the identity and credentials.
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

`public_access_open` is the database gate state. `false` indicates that public
idea and media requests should be blocked; `null` means the gate row is missing.
An open row does not prove journal coverage, effective routing, or successful
responses. The process health endpoint does not check the gate.

This snapshot does not measure availability, provider queue age, disk or
storage growth, backup freshness, or alert delivery. It does not run on a
schedule. Before relying on operational monitoring, configure and test those
signals and notifications for the authorized environment and assign an owner.
Assess the five-second query timeout and connection usage against representative
data volumes and the existing connection limits before scheduling collection.

## Inspect the provider queue

After building the workspace, configure `OPERATIONS_TASK_QUEUE` with the exact
queue resource name and use an authorized identity with `cloudtasks.tasks.list`
on that queue. From the repository root, run:

```sh
node apps/worker/dist/queue-snapshot-cli.js
```

The command requests the basic task view and only creation and schedule times;
it emits aggregate counts and ages, not task identifiers or bodies. It fails
instead of reporting a partial result if listing or pagination fails. Restrict
the identity and avoid publishing the output because aggregate activity can be
sensitive. Hosted access requires separate authorization.

`oldest_seconds` is the age since creation of the oldest listed task, including
tasks scheduled for the future. `due` and `oldest_due_seconds` refer to the
current scheduled attempt; a retry can change its schedule. The listing is not
a transactional snapshot and can change while pages are read, so these values
are estimates. A healthy result does not prove task delivery or configure an
alert. Review collection limits and provider metrics before scheduling it.

## Prepare scheduled collection

The existing foundation can optionally define a Cloud Run job that reuses the
worker image to assess these two snapshots. The collector and its alerts start
disabled; the scheduler starts paused. No additional queue
or database is created. A distinct service account receives queue-scoped
`cloudtasks.tasks.list` and access to an existing operations-only database
secret. That database identity needs the column-scoped read-only grants
described above; they permit reading individual values, so review and restrict it. Secret
Manager grants access to the secret rather than a single version, even though
the job pins a version.

Before a separately authorized plan, review existing jobs, alert policies,
inherited permissions, notification channels, and the connection budget. Use
an immutable worker image containing `dist/operations-monitor-cli.js`, and
prepare an operations-only database secret rather than reusing web, worker, or
backup credentials. Set `enable_operations_monitor`,
`operations_monitor_image`, `operations_database_secret_id`,
`operations_database_secret_version`, `operations_monitor_schedule`, and all
four `operations_thresholds`. The thresholds are whole numbers:
`outbox_seconds`, `overdue_seconds`, and `queue_seconds` are ages in seconds;
`email_events` is a count for each type of event during the preceding 24 hours.
The threshold is breached when the corresponding value reaches it. The queue
age includes future-scheduled tasks, and the outbox age includes future work;
choose thresholds with the deployment's schedules in mind. Email events are not
unique messages, and a zero count does not verify delivery or webhook health.

Optionally set `enable_operations_alert` and the existing
`monitoring_notification_channels` to prepare notifications for threshold
breaches, a closed public-access gate, or a collection error. A missing gate is
an invalid assessment and reports collection failure. The job logs only signal
names and collection status, not task IDs, message details, or aggregate values. For investigation,
use the point-in-time commands above. The alert rate is limited, and repeated
events do not guarantee repeated notifications. A failure before the program
starts, a paused or missed trigger, missing log data, and an unavailable
notification channel can prevent that alert.

The separately enabled `enable_operations_freshness_alert` creates a log-based
completion metric and an alert for two hours without a completed assessment.
The metric starts collecting only after creation. A metric-absence alert needs
at least one successful measurement after setup or a change; it cannot warn
that the first assessment never ran. Resource deletion or shutdown can also
prevent a missing-data incident, and delayed or missing log data can cause false
alerts. Review who can write matching log entries; the signal is not
tamper-proof. Verify the first data point, monitor the job and scheduler separately,
and test missing, delayed, and restored signals with synthetic data in an
authorized environment before relying on freshness notifications.

Test both collection-failure and breach notifications with synthetic data
before relying on this configuration. Do not unpause the trigger
until those checks, provider permissions, thresholds, and overlapping-execution
limits have been reviewed. One task per execution does not prevent concurrent
executions; include them in the database connection budget.

## Inspect provider metrics

In an authorized environment, use the provider consoles to inspect the existing
service, queue, database, and buckets. Confirm the environment and resource
names before selecting them. Do not assume a missing time series means zero.

- Check the deployed web endpoint from outside its runtime and compare the
  result with Cloud Run request and error metrics. The application's
  `/api/health` endpoint reports process health; it does not check the database
  or prove the full user path works.
- Use [Cloud Tasks metrics](https://cloud.google.com/tasks/docs/monitor) for
  queue depth, failed attempts, and attempt delays. These complement the queue
  age snapshot; attempt delay is not the age of the oldest queued task.
- Inspect database size and compute metrics in Neon. Compare trends with the
  intended limits and the [connection guidance](../architecture/neon.md#connection-budget).
- In Cloud Monitoring, inspect `storage.googleapis.com/storage/v2/total_bytes`
  for each relevant bucket, grouped by object type. The [bucket size metric](https://cloud.google.com/storage/docs/getting-bucket-size)
  is measured daily, may be delayed, and does not report empty buckets; it is
  not proof that a particular backup or deleted version exists or expired.

These observations do not establish alert delivery or a regular review. Configure
and test monitoring and notification ownership separately before relying on it.

The foundation can optionally create a Cloud Monitoring HTTPS check for an
approved public hostname. It requests `/api/health` every five minutes, verifies
the certificate and JSON status field, and logs failed checks. A separate
opt-in alert uses existing notification channels; it reports multiple checker
failures sustained for ten minutes. Both options start disabled and create no
notification channels.

Before a separately authorized plan or apply, inspect existing checks and
alerts to avoid duplicates and confirm that the hostname routes to the intended
environment. Configure `enable_public_uptime_check` and
`public_uptime_hostname` in the reviewed foundation configuration. To prepare
the alert, review existing channels and set `enable_public_uptime_alert` and
`monitoring_notification_channels` to their full resource names. Use the
`projects/PROJECT_ID/notificationChannels/CHANNEL_ID` form with this
environment's project ID, even if the provider shows its project number. Test the
check and notification delivery using synthetic data and an authorized failure
scenario, and measure detection delay including metric alignment and provider
latency. Independently verify that the check exists and produces data after
setup and configuration changes. A passing process health check does not establish
database or end-to-end availability.

The foundation can also alert on the 99th percentile of observed task-attempt
dispatch delays over five minutes. To prepare it, review existing alerts and
channels, set `enable_queue_delay_alert`, and set a positive whole-number
`queue_delay_threshold_ms`. The option starts disabled and uses the same
reviewed `monitoring_notification_channels`. The Monitoring resource identifies
the project and queue name but does not include the queue's region; verify that
the name does not also identify a different queue in another region of the same
project. Percentiles from small numbers of attempts can be unstable, and the
provider can delay metric availability. This alert only sees attempted
dispatches: a stopped queue may produce no samples, and a passing result does not
measure the oldest waiting task or outbox age. Check data freshness, schedule
the separate age signals, and test thresholds and notification delivery in an
authorized isolated environment before relying on the alert.

The same foundation can optionally alert when a foundation-owned uploads,
public, or backup bucket exceeds its reviewed byte threshold. These alerts
require `manage_media_buckets = true`; a development rehearsal that omits its
foundation buckets cannot configure them. Set
`enable_storage_capacity_alerts`, provide positive whole-byte values for all
three keys in `storage_capacity_threshold_bytes`, and reuse the reviewed
`monitoring_notification_channels`. The option starts disabled. The policy sums
reported storage classes and object types for each bucket; it measures capacity,
not the rate of growth. The daily and sometimes delayed metric has no series for
an empty bucket, and missing series can understate the total. Verify that data
arrives and independently inspect growth and Neon storage. Test each threshold
and notification in an authorized isolated environment before relying on the
policies.
