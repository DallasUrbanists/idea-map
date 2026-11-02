# Maintain staging media resources

This guide helps operators review the isolated Idea Map staging media buckets,
Resend secret containers, and upload CORS policy without changing unrelated
resources. The staging project is `dallasurbanists-idea-map-dev`, the browser
origin and test sending domain are `https://staging.ideam.app` and
`staging.ideam.app`, and Namecheap manages the domain's DNS.

The following contents links navigate within this guide:

- [Resources and ownership](#resources-and-ownership)
- [Review a staging plan](#review-a-staging-plan)
- [Verify and clean up a test](#verify-and-clean-up-a-test)

## Resources and ownership

The [`infra/media-staging`](../../infra/media-staging) root manages the two
existing staging buckets and two Secret Manager containers in the
`staging/media` Terraform state prefix. The state is in the existing versioned
`dallasurbanists-idea-map-dev-ssr-tfstate` bucket. The root manages metadata and
access configuration only; it does not store secret values or secret versions.

The root also manages the `idea-map-staging-upload` service account. It can
create objects in the upload bucket, while `idea-map-ssr-staging` can sign as
that account and read objects in the preview bucket. Review inherited access
before changing either identity: the token-creator grant also permits
impersonation. These grants do not activate an upload workflow or publisher.

The upload bucket is `dallasurbanists-idea-map-dev-media-uploads`, and the
preview bucket is `dallasurbanists-idea-map-dev-media-previews`. Both enforce
uniform access, public-access prevention, versioning, and seven-day soft-delete
retention. The upload bucket permits signed POST and PUT requests from the exact
staging browser origin; CORS is not a grant to read or upload objects.

The secret containers are `idea-map-staging-resend-api-key` and
`idea-map-staging-resend-webhook-secret`. The
[Resend guide](../architecture/resend.md#staging-provider-details) records the
maintainer's provider choices and the current verification evidence. The
separate [foundation root](../architecture/terraform.md) uses different names;
operators must not create duplicate staging resources or manage the same object
from two Terraform states.

## Review a staging plan

Operators should use the approved development project, the pinned Terraform
provider, and short-lived credentials. From the repository root, initialize the
existing backend and create a plan:

```sh
terraform "-chdir=infra/media-staging" init "-backend-config=bucket=dallasurbanists-idea-map-dev-ssr-tfstate" "-backend-config=prefix=staging/media"
terraform "-chdir=infra/media-staging" plan "-out=review.tfplan"
terraform "-chdir=infra/media-staging" show review.tfplan
```

Operators must review every proposed change and obtain explicit authorization
before applying it. The root's default origin is `https://staging.ideam.app`;
an empty `upload_allowed_origins` list removes browser CORS access. A baseline
plan must not replace or delete buckets, secrets, or existing secret versions.

Terraform state and plans can contain sensitive configuration. Operators should
protect local plan files, remove them after review, preserve the backend and its
version history, and follow the [Terraform recovery guide](../architecture/terraform.md#imports-ownership-and-recovery).
The `prevent_destroy` guards do not replace backups, retention, or review.

## Verify and clean up a test

Reviewers should use only synthetic files and test-owned object names and record
their exact generations. They should verify anonymous denial for pending media,
signed upload expiry and scope, approved preview access, withdrawal, and the
staging-origin CORS response. The [Google Cloud guide](../architecture/google-cloud.md#media-access-and-cleanup)
records completed provider checks and the remaining publication boundary.

After a test, reviewers should wait until its signed access has expired and
remove only the exact test-owned object generations using generation-match
preconditions. They should remove test-only identities and grants created for the
check, retain any object they cannot safely identify, and record the gap. Deleted
generations remain subject to the bucket's soft-delete retention; reviewers must
not delete the buckets, state, unrelated records, or secret versions as cleanup.
