# Validate task delivery in isolated staging

Operators can use this procedure to review task-delivery evidence for #17 and
#31 with synthetic records. The current worker rejects execution, so the
publication scenarios remain blocked until the assessment, identity,
moderation, privacy, and publication gates are implemented and accepted.
Neither this procedure nor a passing local test authorizes deployment or
changes to hosted resources.

## Prepare the review

Before requesting access or an infrastructure plan, record the following inputs
in a reviewable staging proposal without including credentials or private data:

| Input | Required boundary |
| --- | --- |
| Project, region, and owner | An explicitly authorized v2 test project and region; no production or v1 resources |
| State | A separately controlled state bucket and prefix, with access and recovery ownership confirmed |
| Images | Reviewed immutable web and worker image digests and their matching source revisions |
| Database | A disposable PostGIS database containing only synthetic data, with a separate restricted worker credential and connection budget |
| Delivery | A test-only queue, distinct task and repair invoker identities, and a paused hourly scheduler |
| Review and recovery | Named operator, log access, recovery owner, rollback digest, test window, and exact test-owned cleanup scope |

The [Terraform architecture guide](../architecture/terraform.md) describes the
foundation root and its state requirements. That root manages more than task
delivery, including Cloud Run services, buckets, and a queue. Review its full
plan and existing ownership before using it; do not apply it over shared staging
resources or assume the staging web root owns the same state. The foundation
worker currently lacks the required runtime configuration and database secret
binding. Prepare and review those changes before a live plan. The canonical
staging URL does not establish that an isolated worker or queue exists.

Keep `enable_task_delivery` off during initial review. When an operator has
separate authorization to configure test delivery, review a plan with it enabled
and verify that the scheduler is paused, invocation is restricted to the two
distinct identities, queue creation and full-view access are scoped, and task
payloads contain only job identifiers. Do not unpause the scheduler or connect
real assessment data before the rollout gates are accepted. See the
[Google Cloud task guide](../architecture/google-cloud.md#tasks-and-reconciliation)
for runtime settings and the [recovery procedure](../architecture/postgresql-postgis-drizzle.md#outbox-recovery)
for the provider checks required before rearming a delivery.

## Record the synthetic evidence

Use a controlled clock or documented test hook in the isolated database and
record the source revision, image digest, test identifiers, observed states,
and results. Never place raw content, contact data, tokens, or provider
responses in shared logs or evidence. Record each scenario separately:

| Scenario | Required observation |
| --- | --- |
| Complete assessments at immediate and 24-hour boundaries | The stored server receipt and deadline match the policy calculation; incomplete or failed assessments create no automatic deadline |
| Duplicate and superseding assessment, then edit | Duplicate receipt retains the original deadline; replacement starts a new window; old jobs cannot publish another revision |
| Lost dispatch response and hourly repair | The stable task identity and original deadline survive repair, without duplicate effects |
| Duplicate delivery and exhausted retries | Repeated execution has one effect; a pending job can be recovered only after the documented provider and durable-state checks |
| Recently deleted task name | A duplicate-name response with no verifiable live task remains uncertain; recovery does not treat it as successful dispatch |
| Trusted shortcut no longer applies | The shortcut cannot approve; the original standard deadline remains scheduled |
| Moderator hold or decision races publication | A blocking action committed first prevents publication; approved revision and projection intent commit together or both roll back |
| Authentication and privacy | Wrong audience, caller, missing or invalid token cannot execute or repair; pending content and private metadata remain inaccessible |

Before the real execution path and accepted policy are available, run the
existing local synthetic tests in the
[testing guide](../contributor-guides/testing-guide.md#package-tests) and mark
the hosted publication scenarios as unrun. Their injected policy callback is
not evidence of accepted scoring or real moderator authorization.

## Finish the test

Pause any scheduler enabled for the authorized test and record outstanding
jobs, failures, and retry state. Follow the reviewed cleanup plan for only the
identified synthetic records and resources; preserve state, backups, and any
unrelated resources. Verify that no test-owned scheduler or task can continue
running. Record rollback and cleanup results without publishing private logs.
Infrastructure deletion, permission changes, deployment, and production cutover
require their own explicit authorization.
