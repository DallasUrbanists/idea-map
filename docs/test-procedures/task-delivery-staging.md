# Validate task delivery in isolated staging

Operators can use this procedure to review task-delivery evidence with synthetic
records in isolated staging. Publication scenarios require accepted assessment,
identity, moderation, privacy, and publication gates. Neither this procedure nor
a passing local test authorizes deployment or changes to hosted resources.

The following contents links navigate within this procedure:

- [When to use this guide](#when-to-use-this-guide)
- [Prepare the review](#prepare-the-review)
- [Review the scoped delivery configuration](#review-the-scoped-delivery-configuration)
- [Record the synthetic evidence](#record-the-synthetic-evidence)
- [Finish the test](#finish-the-test)

## When to use this guide

Operators and reviewers can use this procedure in the following situations:

| When this happens... | Use this guide to... |
| --- | --- |
| You are preparing an isolated staging review of task delivery. | Identify the required resource boundaries, ownership, and authorization before requesting a plan. |
| You are evaluating an authorized synthetic delivery test. | Record evidence for deadlines, retries, recovery, races, authentication, and privacy. |
| You are finishing an authorized test. | Record the results and follow the reviewed cleanup and recovery plan. |

## Prepare the review

Before requesting access or an infrastructure plan, operators should record the
following inputs in a reviewable staging proposal without credentials or private data:

| Input | Required boundary |
| --- | --- |
| Project, region, and owner | An explicitly authorized development or test project and region, with scoped test resources; no production or v1 resources |
| State | An approved, versioned development state bucket and unique prefix for each root, with access and recovery ownership confirmed |
| Images | Reviewed immutable web and worker image digests and their matching source revisions |
| Database | A disposable Neon/PostGIS database containing only synthetic data, with a separate restricted worker credential and connection budget |
| Delivery | A test-only queue, distinct task and repair invoker identities, and a paused hourly scheduler |
| Review and recovery | Named operator, restricted log access and retention, logging cost review, recovery owner, rollback digest, test window, and exact test-owned cleanup scope |

The [Terraform architecture guide](../architecture/terraform.md) describes the
foundation root and its state requirements. That root manages more than task
delivery, including Cloud Run services, buckets, and a queue. Operators should
review its full plan and existing ownership before using it; they must not apply it over
shared staging resources or assume the staging web root owns the same state.
Operators should review the opt-in worker runtime configuration, exact service
URI, and pinned existing database secret before a live plan. The canonical
staging URL does not establish that an isolated worker or queue exists.

The [Neon architecture](../architecture/neon.md#environments-and-connections)
defines the hosted database choice and isolation. Operators should inspect
existing development test resources before proposing new ones, verify that the
worker credential has the required restricted permissions, and include all
shared-compute connections in the capacity review. An existing web test role is
not evidence that worker access is adequate. Separate Terraform state prefixes
can use an existing approved development bucket when its access and recovery
controls are suitable; a new bucket is not required solely for another root.

Operators should keep `enable_task_delivery` off during initial review. When an
operator has separate authorization to configure test delivery, review a plan with it enabled
and verify that the scheduler is paused, invocation is restricted to the two
distinct identities, queue creation and full-view access are scoped, and task
payloads contain only job identifiers. Do not unpause the scheduler or connect
real assessment data before the rollout gates are accepted. See the
[Google Cloud task guide](../architecture/google-cloud.md#tasks-and-reconciliation)
for runtime settings and the [recovery procedure](../architecture/postgresql-postgis-drizzle.md#outbox-recovery)
for the provider checks required before rearming a delivery.

## Review the scoped delivery configuration

The independent [`infra/task-delivery-staging`](../../infra/task-delivery-staging)
root manages only a synthetic queue, task and repair identities, their scoped IAM
members, and a paused hourly scheduler. It reads an already existing isolated
worker; it does not create or configure that worker, its database, web service,
or storage. Its [example variables](../../infra/task-delivery-staging/synthetic.tfvars.example)
are deliberately non-live and leave the root disabled. A synthetic name does not
prove that a resource or project is isolated.

The foundation worker's runtime settings refer to the queue and invoker
identities managed by `infra/terraform`. The scoped root defines different
resources and does not replace those settings. Operators using the foundation
worker should review and use the foundation-owned delivery resources, rather
than create a second queue and scheduler for that worker. Use the scoped root
only for an independently configured isolated worker whose reviewed settings
match its resources, and confirm that no other root manages the same objects.

The scoped root's synthetic queue requests logging for every operation so
operators can review dispatch and response attempts.
[Cloud Tasks logging](https://docs.cloud.google.com/tasks/docs/monitor#use-cloud-logging-with-queues)
is sampled at zero by default and a full sampling setting does not prove that
every log was retained or delivered. Before any live plan, operators should
review log routing, restricted access, retention, exclusions, and cost. Logs can
contain task and queue identifiers; keep them and provider responses out of
public evidence. The foundation queue has its own configuration; this logging
setting does not apply to it. Review its logging separately and do not create a
second queue merely to obtain logs. Do not use the scoped synthetic
configuration for real submissions.

Before requesting a live plan, prepare a review record containing the exact
isolated project and region, approved state bucket and unique prefix, worker
service and origin, worker runtime identity and reviewed image digest, pinned test-only
database secret version, queue and invoker names, operator and recovery owner,
and cleanup exclusions. Confirm that no other Terraform root manages these
same resources or IAM members. The worker must already have the reviewed queue,
invoker, origin, and database settings; this root does not change them. Review
inherited IAM and ingress separately. The configuration checks the selected
worker's URI, runtime identity, internal ingress, and IAM setting, but it does
not prove inherited permissions or provider reachability are safe.

From the repository root, reviewers can validate the configuration without a
cloud account or live state:

```sh
terraform fmt -check -recursive infra/task-delivery-staging
terraform -chdir=infra/task-delivery-staging init -backend=false -lockfile=readonly
terraform -chdir=infra/task-delivery-staging validate
terraform -chdir=infra/task-delivery-staging test
```

The tests use a mocked provider and synthetic values. Initialization may fetch
the pinned provider; it does not configure a remote backend or provision
resources.

After separate explicit authorization for staging access, an operator can
first inspect a plan with delivery disabled. A plan with
`enable_isolated_staging = true` must still be reviewed, and applying it needs
separate explicit authorization. Confirm distinct task and repair invokers, bounded
queue retries, queue-scoped worker access, exact OIDC audience, and a paused
scheduler. The worker's real execution path remains disabled. Cloud Tasks and
Scheduler reachability, duplicate-name retention, retry schedule behavior,
identity permissions, and cache effects require actual isolated staging evidence;
mocked tests cannot establish them.

For rollback after separately authorized testing, pause the scheduler, stop new
enqueues, record outstanding tasks and durable job states, and preserve the
reviewed state and synthetic evidence. Restore a reviewed prior worker image
and settings only under separate authorization. The queue, scheduler, and
invoker accounts have `prevent_destroy` guards. Do not use a blanket destroy;
changing those guards, resource removal, permission changes, and cleanup require
their own reviewed scope and authorization.

## Record the synthetic evidence

For an authorized hosted test, operators should inspect the synthetic queue's
`AttemptDispatch` and `AttemptResponse` logs and compare observed attempts and
responses with the durable job state. Record the outcome and any missing evidence
without publishing task identifiers or raw logs. A log entry alone does not prove
the job's database effect or establish that recovery is safe.

Operators should use a controlled clock or documented test hook in the isolated
database and record the source revision, image digest, test identifiers, observed states,
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

Operators should run the existing local synthetic tests in the
[testing guide](../contributor-guides/testing-guide.md#package-tests) and mark
any hosted publication scenarios that were not executed as unrun. Their injected
policy callback is not evidence of accepted scoring or real moderator authorization.
The controlled-time worker delivery check combines the adopted deadline
calculation with a fake task transport, fake token verification, and synthetic
approval. It checks lost responses, delayed repair, duplicate delivery, and
superseded jobs; it does not validate Google services or enable production
execution. Reviewers should use a separate empty, migrated local `idea_map_test_*`
database, set `TEST_DATABASE_URL`, and run
`pnpm --filter @idea-map/worker test:delivery` from the repository root.

## Finish the test

Operators should pause any scheduler enabled for the authorized test and record
outstanding jobs, failures, and retry state. Follow the reviewed cleanup plan for only the
identified synthetic records and resources; preserve state, backups, and any
unrelated resources. Verify that no test-owned scheduler or task can continue
running. Record rollback and cleanup results without publishing private logs.
Infrastructure deletion, permission changes, deployment, and production cutover
require their own explicit authorization.
