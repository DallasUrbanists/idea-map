# Terraform foundation and review plan

Status: proposed definitions only. Nothing here provisions resources, changes IAM,
creates credentials, activates billing or touches v1. The pilot assumptions and
owners are in [pilot-cost-research.md](pilot-cost-research.md). This is a partial
foundation, not a deployable end-to-end system: networking, HTTPS/public access,
secret grants, task invocation, scheduler, Firestore, Firebase Hosting, Neon,
backup execution, monitoring and CI identity remain separate reviewed work.

## Reviewable proposed changes

| Address / scope | Proposed behavior | Review before any real plan or apply |
| --- | --- | --- |
| `google_service_account.runtime` | Separate web and worker identities per environment, no IAM grants | Verify names, required permissions and deployment ownership; never reuse v1 identities |
| `google_cloud_run_v2_service.runtime` | Internal-only services, separate identities, immutable images, zero minimum; web max 2/concurrency 20, worker max 1/concurrency 1 | Verify image provenance, sizing, health, runtime secrets and reviewed ingress/invoker grants. Internal ingress intentionally means no public web service yet |
| `google_storage_bucket.media` | Separate uploads, approved-media and backup buckets; uniform access, public access prevention, versioning, no forced deletion and `prevent_destroy` | Confirm unique names, retention, costs, backup access and recovery; approved-media stays private until a separately reviewed delivery design |
| `google_cloud_tasks_queue.jobs` | Per-environment queue with bounded dispatch and five attempts | Verify quotas, idempotent handlers, dead-letter/reconciliation behavior and authenticated target before use |

Only an actual credentialed Terraform plan against the approved state and target
can determine exact creates, updates, replacements and deletes. The table above is a
proposed change inventory, **not** live plan output. A plan must be reviewed before
any future apply. No apply is authorized by this issue.

## State, isolation and bootstrap

Use separate pre-existing, versioned GCS state buckets (or separately controlled
projects) for dev and production, with distinct access policies and unique prefixes.
Restrict state read/write to the environment's infrastructure operators; state can
contain sensitive values even when outputs are marked sensitive. Never put secrets
or state files in Git, build artifacts or logs. Enable audit logs, recovery and
retention policies appropriate to state; test state restoration and maintain an
independent recovery procedure. The [GCS backend](https://developer.hashicorp.com/terraform/language/backend/gcs)
requires an existing bucket, supports locking, and recommends object versioning.
Do not disable locks to work around contention.

A separately authorized operator must first confirm projects, billing, region,
state bucket names, access and versioning, and bootstrap the backend outside this
root. Bootstrap itself requires a separate reviewed plan and must not create or
alter v1 resources. Record ownership and recovery for the bootstrap state before
initializing this root. Do not pass credentials via `-backend-config`; use the
operator's short-lived credentials and approved identity. Example commands below are
illustrative and must not be run against a real environment without authorization:

```sh
terraform init -backend-config="bucket=REVIEWED_STATE_BUCKET" -backend-config="prefix=idea-map/dev"
terraform plan -var-file=dev.tfvars -out=review.tfplan
terraform show review.tfplan
```

Use different explicit project IDs, bucket names, backend state and credentials for
dev and prod; dev uses synthetic data only. Supply reviewed image digests and
variables through environment-specific, non-secret var files excluded from Git.
Do not use v1 projects, data, buckets, state or credentials. Secure and delete plan
files after review; plans may contain sensitive configuration.

## Imports, ownership and recovery

This root assumes new v2-owned resources. Before adopting any existing v2 object,
compare its live configuration and ownership, record the identifier and dependencies,
and use a separately reviewed import plan. Do not import v1 resources or allow an
import to transfer ownership implicitly. No automatic destroy workflow is provided.
State buckets, backups, user media, data stores, DNS and shared identity/billing
resources are teardown exclusions; `prevent_destroy` on managed buckets is a guard,
not a substitute for a reviewed retention and recovery policy. Removal of that
configuration can remove the guard. Test restoration of daily backups in an isolated
project against the pilot's 24-hour recovery objectives before launch.

## Validation without infrastructure changes

Run `terraform fmt -check -recursive`, `terraform init -backend=false`,
`terraform validate`, and `terraform test` with the mocked Google provider in an
isolated checkout. Mock tests use synthetic values and do not verify provider APIs,
IAM, deployment, costs or existing infrastructure. A real plan requires an approved
v2 project, pre-existing backend, operator credentials, enabled APIs and reviewed
image digests and names. If these are unavailable, report the missing prerequisites
and do not describe a mock plan as a live plan.

## Decisions before provisioning

Confirm state ownership and backup operator, distinct projects and billing, service
and bucket names, access and public media delivery, workload identity/IAM, secret
and task invoker scopes, network/region and quotas, Firestore/Neon ownership,
recovery/retention and cost controls. Gemini remains disabled pending separate
review. See [#8](https://github.com/DallasUrbanists/idea-map/issues/8) for the
budget baseline and [#9](https://github.com/DallasUrbanists/idea-map/issues/9) for
this proposed configuration.
