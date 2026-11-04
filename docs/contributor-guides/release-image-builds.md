# Build staging release images

Release operators can build and inspect the web and worker images from a
reviewed commit on `main`. The manually started workflow first requires the
latest main-branch moderation, browser, and dependency-audit runs for that exact
commit to pass, then builds and smoke-tests both images and records their
Artifact Registry digests. It does not deploy either image.

The following contents links navigate within this guide:

- [Prerequisites](#prerequisites)
- [Run and review the build](#run-and-review-the-build)

## Prerequisites

An authorized administrator must establish a separate v2 staging project,
Artifact Registry repository, and GitHub `staging` environment before this
workflow can publish images. Review access and environment protection rules
before enabling it; creation of cloud resources, IAM grants, and publication
require separate authorization. Do not use production or v1 resources.

Configure these variables on the GitHub `staging` environment:

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | The isolated staging project ID. |
| `GCP_ARTIFACT_REGION` | The Artifact Registry location, such as `us-central1`. |
| `GCP_ARTIFACT_REPOSITORY` | The existing Docker repository ID. |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | The full resource name of the staging Workload Identity Federation provider. |
| `GCP_IMAGE_BUILDER_SERVICE_ACCOUNT` | The staging-only image builder service account email. |

The federation trust policy must restrict the repository's immutable owner and
repository IDs, the `main` ref, and the protected `staging` environment. The
builder must have only the repository-scoped permissions needed to push and
inspect images. Review inherited permissions,
branch restrictions, required reviewers, and the ability to change workflow
files and environment settings. Constrain the builder grant to the image-build
workflow and the deployer grant to the release workflow; see the
[Cloud Run release guide](cloud-run-release.md#identity-and-environment-setup).
See Google's
[authentication action guidance](https://github.com/google-github-actions/auth#setting-up-workload-identity-federation)
and GitHub's [deployment environment guidance](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments).

## Run and review the build

After obtaining authorization to publish staging images, an operator should
start **Build staging release images** from the Actions tab on `main` and pass
the environment's protection rules. The workflow refuses other branches and
repositories. A job without cloud identity builds and checks the images, then
passes a checksummed archive to the protected publishing job. The publishing
job pushes both under a run-specific tag, checks the registry digest against the
local pushed image, and records the digests and source commit in the run summary.
It requests retention of the `release-image-metadata` artifact for 90 days,
subject to repository retention limits.

The intermediate image archive has one-day retention. If approval is delayed
until it expires, the publishing job fails and an operator must start a new
build. If publishing fails before the archive expires, rerun the failed job to
reuse the checked archive from the successful build; the published metadata is
identified by the new publishing attempt.

Review the run result, source commit, both smoke checks, registry destination,
and both digest references. A failed run can leave one image in the registry;
do not treat a partial run as a release. Registry cleanup is a separate
authorized operation.

The summary is build evidence, not evidence of a deployment or a healthy Cloud
Run revision. Follow the [Cloud Run release guide](cloud-run-release.md) for
staging, production promotion, and rollback.
