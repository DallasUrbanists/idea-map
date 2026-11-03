# Release and recover Cloud Run services

Release operators can prepare, promote, and roll back the web and worker
services through the manually started **Cloud Run release** workflow. This
guide describes the required identities and evidence, the release sequence,
and recovery from an interrupted operation. Deployments, registry publication,
provisioning, and access changes require separate explicit authorization.

The following contents links navigate within this guide:

- [Identity and environment setup](#identity-and-environment-setup)
- [Ownership and release evidence](#ownership-and-release-evidence)
- [Prepare and promote a release](#prepare-and-promote-a-release)
- [Roll back or recover an interrupted operation](#roll-back-or-recover-an-interrupted-operation)
- [Validation limits](#validation-limits)

## Identity and environment setup

An authorized administrator should prepare separate v2 staging and production
projects, registries, identities, and Terraform state using reviewed plans.
Do not use v1 projects or data. Existing synthetic staging roots are separate
from the foundation's `idea-map-*-dev` services; do not make two Terraform
roots manage the same service.

For a new development-only release rehearsal that does not need media, set
`manage_media_buckets = false` and leave `enable_media_access` off. The
foundation then leaves existing staging media buckets under their current root
and creates no backup bucket. This does not configure media access or backup
recovery; review those separately before using those features. Do not use this
setting to remove buckets already managed by the foundation.

Before enabling either workflow, an authorized administrator should create
GitHub environments named `staging` and `production`, restrict them to
`main`, and require independent reviewers for production. The administrator
should verify the rules are actually enforced, prevent self-approval where
available, and restrict who can edit the workflows and environments. GitHub can
create an unconfigured environment implicitly, so a name alone is not a gate.

Configure these variables separately on each environment, not as shared
repository variables:

| Variable | Meaning |
| --- | --- |
| `GCP_PROJECT_ID` | Existing v2 project ID for this environment. |
| `GCP_RUN_REGION` | Region of the foundation services, such as `us-central1`. |
| `RELEASE_IMAGE_REPOSITORY` | Exact Artifact Registry repository path in the target project, without an image name or trailing slash. |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full resource name of this environment's federation provider. |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | Environment-specific deployer service account email in the target project. |

The [image-build guide](release-image-builds.md#prerequisites) lists the
additional staging builder variables. Restrict the federation provider and
service-account grants by immutable GitHub owner and repository IDs, the
`main` ref, the environment, and the approved workflow identity. The
builder and deployer grants must be distinct even when they use the same
provider; check mapped claims, inherited permissions, and actual token behavior
before enabling access. Do not issue long-lived service-account keys.

The deployer needs access to inspect and update only the two intended Cloud Run
services, read their revisions, read the relevant image repository, and act as
only their runtime identities. Review the actual permissions and service agent
image access against
[Google's deployment requirements](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration#required-roles).
The builder needs staging registry write access, not deploy or production access.
Any separate production image-copy identity needs only the approved source read
and destination write access.

## Ownership and release evidence

Terraform creates the services using bootstrap image digests, their runtime
identities, configuration, scaling, and ingress. After creation, the release
workflow owns image and traffic changes; Terraform ignores those fields to
avoid silently reverting a release. Operators should review a real Terraform
plan before every separately authorized apply, and check which revision and
traffic will remain active when other service configuration changes.

If the worker's generated URI is not yet known, the
[Terraform guide](../architecture/terraform.md#resource-definitions) describes
an opt-in, dev-only bootstrap process that returns 503. Replace it with the
configured worker through a separately reviewed Terraform plan before using
the release workflow. A bootstrap revision is not a recovery target: the
workflow rejects worker revisions with overridden commands or arguments.

Before a Neon-backed web service is created, prepare a web-only pooled TLS
database credential and existing Secret Manager version outside Terraform. Set
both `web_database_secret_id` and the numeric `web_database_secret_version` in
the reviewed environment configuration. Review the web role, secret access,
and connection budget separately from the worker's credential. A database
reference alone does not prove that the service can authenticate or that its
schema and permissions are correct; verify those in the isolated environment.

The workflow operates on `idea-map-web-dev` and `idea-map-worker-dev` in
staging and the corresponding `-prod` services in production. It requires one
explicit current revision with all traffic, request-based CPU, zero minimum
instances, the expected runtime identity, and internal worker ingress. The
workflow serializes its own operations, but it cannot lock Terraform, console
changes, or other tools; operators must serialize those changes separately.
GitHub may replace a pending run when another run enters the same concurrency
group. Check each run's status instead of assuming that queued work will run.

For preparation and promotion, provide a successful **Build staging release
images** run ID and attempt. Its retained metadata artifact binds each image
digest to the checked source commit. For production, also provide the
successful staging **promote** run ID and attempt for the same service and
digest; the workflow verifies both records before requesting deployment access.

The release workflow checks the revision's `Ready` condition, reconciled
generation, and resolved image digest. These are provider metadata, not proof
that a database, task delivery, public routing, or the application works.
Operators should retain the release summaries, artifact references, test
evidence, compatibility decision, and recovery owner beyond artifact expiry.

## Prepare and promote a release

After receiving authorization for the target environment, an operator should
follow these steps for each service:

1. Build the images using the [image-build guide](release-image-builds.md) and
    record the successful run ID, attempt, and both digest references.
2. Review schema and data compatibility with both old and new web and worker
    versions, the current 100% traffic revision, configuration, and recovery
    owner. Decide the service order because the two services cannot switch
    atomically.
3. Start **Cloud Run release** on `main` with environment `staging`, operation
    `prepare`, the service, its built image, current revision, and build run
    ID and attempt. The workflow creates a revision without changing traffic
    and reports its name and health metadata.
4. After reviewing the candidate and approving the staging change, start the
    workflow with operation `promote`, the candidate revision, the same image
    and build evidence, and the still-current revision. Review the receipt and
    test the staging service with synthetic data and approved access.
5. For production, copy the exact tested digest to the separately controlled
    production repository using an authorized image-copy procedure and verify
    the destination digest matches. Review the copy procedure below before
    copying.
6. Start production `prepare` with the destination image digest, current
    production revision, build run and attempt, and successful staging
    promotion run and attempt. After the protected-environment review and
    candidate metadata check, start production `promote` with the resulting
    revision and the same evidence.
7. Check the traffic result, service health, application behavior, and
    environment-specific monitoring after each promotion. Keep the prior
    revision and image available for recovery.

An authorized operator can use `gcrane` with short-lived credentials and
the [reviewed registry access](https://cloud.google.com/artifact-registry/docs/docker/copy-images)
to copy a single digest:

```sh
gcrane cp SOURCE_IMAGE_BY_DIGEST DESTINATION_IMAGE:RELEASE_TAG
gcrane digest DESTINATION_IMAGE:RELEASE_TAG
```

Replace the following:

- `SOURCE_IMAGE_BY_DIGEST`: The exact staging image reference from the
    successful build and staging promotion.
- `DESTINATION_IMAGE`: The matching service image path in the production
    repository, without a tag or digest.
- `RELEASE_TAG`: A unique reviewed tag for this copy.

Compare the returned digest to the source digest before using
`DESTINATION_IMAGE@sha256:DIGEST` in the production workflow. Replace
`DIGEST` with the matching hexadecimal digest; a changed digest is not the
same artifact and the release workflow rejects it.

The workflow does not create public routing, grant invocation, change the
worker's task identities, unpause the scheduler, run migrations, or authorize a
production cutover. Production application routing remains a separate reviewed
operation. Do not enable automated moderation until its independent policy and
delivery gates are met.

## Roll back or recover an interrupted operation

Before routing back, an authorized operator should check the previous revision,
its immutable image, database compatibility, retained secrets and provider
configuration. Select `rollback`, the environment and service, the previous
revision and image, and the revision currently receiving all traffic. Rollback
does not depend on an unexpired build artifact, but the protected environment
still requires its configured approval.

Cloud Run does not repeat its deployment health check during a traffic rollback.
The workflow verifies recorded revision metadata before routing and the traffic
assignment afterward; operators must also check real application behavior.
Traffic moves are not instantaneous, and two-service releases are not atomic.

If a candidate fails to start, the service can report `Ready=False` while an
earlier revision still receives traffic. After reconciliation completes, the
workflow permits recovery only after checking the observed traffic and serving
revision's identity, configuration, and image digest; a promotion or rollback
target must independently report `Ready=True`. For a worker, the observed
ingress must also be internal because a failed change can leave the active
ingress different from the requested setting. The serving revision can be
unhealthy, so operators should inspect its condition and application behavior
before choosing a recovery action. An unknown, missing, or unreconciled status
blocks the operation.

If a command times out, a receipt upload fails, or the result is uncertain,
operators should inspect both the service's live traffic and revision status
before retrying. Never assume a failed run left traffic unchanged. Reconcile
the expected-current input with the observed revision, then use a separately
approved promotion or rollback and record the outcome.

## Validation limits

The local tests use synthetic Cloud Run responses and do not contact Google.
An authorized isolated staging exercise must verify actual provider response
shapes, registry digests, federation restrictions, environment approvals,
revision health, traffic movement, compatibility, and rollback. A passing
mock test or a configured staging URL does not establish those results.
