# Maintain staging media resources

This procedure helps operators review the isolated Idea Map staging media buckets,
Resend secret containers, and upload CORS policy without changing unrelated
resources. The staging project is `dallasurbanists-idea-map-dev`, the browser
origin and test sending domain are `https://staging.ideam.app` and
`staging.ideam.app`, and Namecheap manages the domain's DNS.
The Resend team is `dallasurbanists`, and the sending domain uses the North
Virginia (`us-east-1`) region. Operators should verify the provider's domain
status and current DNS records before enabling delivery.

The following contents links navigate within this guide:

- [Resources and ownership](#resources-and-ownership)
- [Review a staging plan](#review-a-staging-plan)
- [Verify and clean up a test](#verify-and-clean-up-a-test)
- [Configure the delivery webhook](#configure-the-delivery-webhook)
- [Verify and recover delivery](#verify-and-recover-delivery)

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
impersonation.

The upload bucket is `dallasurbanists-idea-map-dev-media-uploads`, and the
preview bucket is `dallasurbanists-idea-map-dev-media-previews`. Both enforce
uniform access, public-access prevention, versioning, and seven-day soft-delete
retention. The upload bucket permits signed POST and PUT requests from the exact
staging browser origin; CORS is not a grant to read or upload objects.

The secret containers are `idea-map-staging-resend-api-key` and
`idea-map-staging-resend-webhook-secret`. The
[Resend guide](../architecture/resend.md#staging-provider-details) records the
credential and delivery requirements. Operators should inspect the available
secret versions and use a sending-only key scoped to `staging.ideam.app`. The
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
describes the publication boundary.

After a test, reviewers should wait until its signed access has expired and
remove only the exact test-owned object generations using generation-match
preconditions. They should remove test-only identities and grants created for the
check, retain any object they cannot safely identify, and record the gap. Deleted
generations remain subject to the bucket's soft-delete retention; reviewers must
not delete the buckets, state, unrelated records, or secret versions as cleanup.

## Configure the delivery webhook

The `infra/resend-staging` root owns the separate `idea-map-resend-staging`
service, its runtime identity, the `idea_map_resend_staging` database on the
existing staging Cloud SQL instance, and the database URL secret container. Its
Terraform state uses the `staging/resend-webhook` prefix in the staging state
bucket. The existing webhook signing-secret container remains managed by the
media staging root; secret values and versions are managed outside Terraform.

Operators should build a reviewed image pinned by digest and use an authorized
staging administrator, the Cloud SQL Auth Proxy, and short-lived credentials.
The service accepts `GET /api/health` and signed `POST /api/webhooks/resend`;
other dynamic application routes are unavailable. Public static assets remain
accessible. Its database contains synthetic test data only and its runtime role
has no permission to read email IDs or message content.

From the repository root, operators can initialize the separate backend:

```sh
terraform "-chdir=infra/resend-staging" init "-backend-config=bucket=dallasurbanists-idea-map-dev-ssr-tfstate" "-backend-config=prefix=staging/resend-webhook"
```

Operators should place only non-secret variables in an ignored local
`infra/resend-staging/staging.tfvars`, then create and inspect each plan:

```sh
terraform "-chdir=infra/resend-staging" plan "-var-file=staging.tfvars" "-out=review.tfplan"
terraform "-chdir=infra/resend-staging" show review.tfplan
```

The Terraform output `webhook_url` identifies the endpoint after the service is
enabled. State and plans can contain sensitive configuration and need the same
protection as the media staging state.

1. Initialize the separate Terraform backend, set `web_image` to the reviewed
    image digest, and review a plan with `enable_service = false`. Confirm that
    it creates only the isolated database, runtime identity, database secret,
    and scoped grants before an authorized apply.
2. Connect to `idea_map_resend_staging` through the Cloud SQL Auth Proxy using
    the staging administrator credential. Apply the reviewed database migrations
    with the direct administrative connection and create the dedicated
    `idea_map_resend_runtime` login using a securely generated password. Use a
    secure prompt such as `psql`'s `\password`, not a password in a SQL command.
3. Revoke database `CONNECT` and schema `public` access from `PUBLIC`, then grant
    the runtime role database `CONNECT`, schema `USAGE`, `INSERT` on
    `email_delivery_events(event_id, email_id, event_type, occurred_at)`, and
    `SELECT` on `email_delivery_events(event_id)`. Verify the insert and duplicate
    check work and that reading `email_id` is denied.
4. Store the runtime connection URL, including the Cloud SQL socket path and
    runtime credential, as a Secret Manager version in
    `idea-map-staging-resend-database-url`. Enter it through an approved secret
    workflow; do not put credentials in Terraform, command arguments, logs, or
    source control.
5. Set `enable_service = true` and `database_secret_version` to that numeric
    version, then review and apply a plan that creates only the isolated service.
    With no signing secret configured, its webhook returns `503` and does not
    accept events.
6. Register the service's `webhook_url` output in the development Resend account
    for the required delivery event types. Store the provider-generated signing
    secret as a new version of `idea-map-staging-resend-webhook-secret` without
    disclosing it, and pin that numeric version in `webhook_secret_version`.
7. Review and apply the plan for the scoped secret grant and updated service,
    then confirm a fresh plan has no unexpected changes. Review inherited access
    and remove temporary test grants without changing unrelated services.

## Verify and recover delivery

Operators should send only synthetic mail using the restricted staging key and
check a verified delivery event reaches the database before acknowledgement.
They should also test invalid signatures, duplicate delivery, retry after a
temporary database failure, and provider-domain authentication with a controlled
test mailbox. Resend's team inbound address can receive a synthetic message, but
its displayed headers do not necessarily provide independent recipient-side SPF,
DKIM, and DMARC verdicts.

Operators should record test IDs and results without message content or secrets,
remove only test-owned database events, and follow provider retention rules for
test messages and webhook attempts. If the webhook or database is unavailable,
repair the cause and replay only after confirming idempotency. When rotating a
signing secret, coordinate the provider endpoint and pinned Secret Manager
version, preserve a rollback path, and test delivery before disabling the prior
version.
