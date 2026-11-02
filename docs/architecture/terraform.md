# Terraform architecture

Infrastructure changes can affect services, stored data, and access. This guide
helps you understand Idea Map's Terraform resources, review a plan, and handle
state and recovery. Operators should obtain explicit authorization for live
operations; changing documentation does not authorize provisioning.

The [Google Cloud guide](google-cloud.md) defines hosted service
responsibilities. Terraform definitions live in
[`infra/terraform`](../../infra/terraform).

The following contents links navigate within this guide:

- [Resource definitions](#resource-definitions)
- [State, isolation, and bootstrap](#state-isolation-and-bootstrap)
- [Imports, ownership, and recovery](#imports-ownership-and-recovery)
- [Validation without infrastructure changes](#validation-without-infrastructure-changes)
- [Decisions before provisioning](#decisions-before-provisioning)

## Resource definitions

Before running a live plan or apply, operators should check the resources in
this table:

| Address / scope | Resource behavior | Review before any real plan or apply |
| --- | --- | --- |
| `google_service_account.runtime` | Separate web and worker identities per environment, no IAM grants | Verify names, required permissions and deployment ownership; never reuse unrelated identities |
| `google_cloud_run_v2_service.runtime` | Internal-only services, separate identities, immutable images, zero minimum; web max 2/concurrency 20, worker max 1/concurrency 1 | Verify image provenance, sizing, health, runtime secrets and reviewed ingress/invoker grants. Public web routing requires explicit reviewed ingress and invoker configuration |
| `google_storage_bucket.media` | Separate uploads, approved-media and backup buckets; uniform access, public access prevention, versioning, no forced deletion and `prevent_destroy` | Confirm unique names, retention, backup access and recovery; approved-media access uses the reviewed delivery boundary |
| `google_cloud_tasks_queue.jobs` | Per-environment queue with bounded dispatch and five attempts | Verify quotas, idempotent handlers, dead-letter/reconciliation behavior and authenticated target before use |

The definitions in this table do not show which changes a live plan will report.
An actual credentialed plan against the approved state and target shows the
exact creates, updates, replacements, and deletes. A plan must be reviewed
before any apply. Applying infrastructure requires explicit authorization.

## State, isolation, and bootstrap

Operators should use separate pre-existing, versioned Google Cloud Storage (GCS)
state buckets (or separately controlled projects) for dev and production, with
distinct access policies and unique prefixes. Restrict state read/write to the
environment's infrastructure operators; state can contain sensitive values even
when outputs are marked sensitive. Never put secrets or state files in Git,
build artifacts, or logs. Enable audit logs, recovery, and retention policies
appropriate to state; test state restoration and maintain an independent
recovery procedure. The
[GCS backend](https://developer.hashicorp.com/terraform/language/backend/gcs)
requires an existing bucket, supports locking, and recommends object versioning.
Do not disable locks to work around contention.

An authorized operator should first confirm projects, region, state bucket
names, access, and versioning, and bootstrap the backend outside this root.
Bootstrap itself requires a separate reviewed plan and must not create or alter
unrelated resources. Operators should record ownership and recovery for the
bootstrap state before initializing this root. Do not pass credentials via
`-backend-config`; use the operator's short-lived credentials and approved
identity. Operators should treat the following commands as examples and obtain
explicit authorization before running them against a real environment. Run them
from `infra/terraform` in a prepared checkout with a Terraform version matching
[`versions.tf`](../../infra/terraform/versions.tf):

```sh
terraform init -backend-config="bucket=REVIEWED_STATE_BUCKET" -backend-config="prefix=idea-map/dev"
terraform plan -var-file=dev.tfvars -out=review.tfplan
terraform show review.tfplan
```

As the operator, you should replace `REVIEWED_STATE_BUCKET` with the authorized
existing state bucket and use an environment-specific `dev.tfvars` containing
reviewed, non-secret variables. The prefix `idea-map/dev` separates this
environment's state; `review.tfplan` is the sensitive local plan artifact for
inspection.

Operators should use different explicit project IDs, bucket names, backend
state, and credentials for dev and prod; dev uses synthetic data only. Supply
reviewed image digests and variables through environment-specific, non-secret
var files excluded from Git. Do not use unrelated projects, data, buckets, state
or credentials. Secure and delete plan files after review; plans can contain
sensitive configuration.

## Imports, ownership, and recovery

This root manages project-owned resources. Before adopting an existing project
object, operators should compare its live configuration and ownership, record
the identifier and dependencies, and use a separately reviewed import plan. Do
not import unrelated resources or allow an import to transfer ownership
implicitly.

Deleting infrastructure requires an explicit operation and authorization. State
buckets, backups, user media, data stores, Domain Name System (DNS), and shared
identity resources are teardown exclusions; `prevent_destroy` on managed buckets
is a guard, not a substitute for a reviewed retention and recovery policy.
Removal of that configuration can remove the guard.

Operators should test restoration of daily backups in an isolated project
against the application's 24-hour recovery objectives before launch.

## Validation without infrastructure changes

From `infra/terraform`, you should run
`terraform fmt -check -recursive`, `terraform init -backend=false`,
`terraform validate`, and `terraform test` with the mocked Google provider in an
isolated checkout. Mock tests use synthetic values. They do not check real
provider APIs, identity and access management (IAM), deployment, or existing
infrastructure. A real plan requires an approved target project, pre-existing
backend, operator credentials, enabled APIs and reviewed image digests and
names. If these are unavailable, you should report the missing prerequisites and
should not describe a mock plan as a live plan.

## Decisions before provisioning

Operators should confirm state ownership and backup operator, distinct projects,
service and bucket names, access and public media delivery, workload
identity/IAM, secret and task invoker scopes, network/region and quotas,
Firestore/Neon ownership, recovery/retention and resource limits. Gemini remains
disabled pending separate review. The
[architecture overview](architecture-overview.md#environments-and-recovery)
defines recovery objectives and environment isolation.
