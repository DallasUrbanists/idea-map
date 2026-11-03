# Google Cloud architecture

Google Cloud provides computing, storage, and other services that applications
can use over the internet. Idea Map's web app, background jobs, and stored media
rely on several of these services working together. This guide helps you follow
those connections and understand which identities can access each resource. You
can find resource management details in the [Terraform guide](terraform.md) and
account handling in the [Firebase guide](firebase.md).

The following contents links navigate within this guide:

- [Hosting and compute](#hosting-and-compute)
- [Tasks and reconciliation](#tasks-and-reconciliation)
- [Media and secrets](#media-and-secrets)
- [Media access and cleanup](#media-access-and-cleanup)
- [Identity and deployment boundaries](#identity-and-deployment-boundaries)
- [Regions and provider integrations](#regions-and-provider-integrations)

## Hosting and compute

Firebase Hosting serves static assets through its global content delivery
network (CDN) and forwards server-side rendering (SSR) and API traffic to the
Cloud Run web service. A separate Cloud Run worker handles authenticated
background tasks and reconciliation. Each environment has separate web and
worker service accounts, resources, and secrets.

The isolated [SSR staging service](../contributor-guides/ssr-staging.md) uses
synthetic data, a separate Cloud SQL database, and staging-only shared caching.
The [Hosting cache guide](hosting-cache.md) describes its cache restrictions.

Cloud Run uses immutable image digests and zero minimum instances. The
configured starting bounds are two web instances with concurrency 20 and one
worker instance with concurrency 1 per environment. Before changing those
limits, you should load-test them along with the database pool sizes.

Infrastructure definitions use internal ingress until an explicit ingress and
invoker configuration authorizes the required traffic. The deployment must
provide reviewed public web routing without exposing worker endpoints or private
media.

## Tasks and reconciliation

Cloud Tasks dispatches bounded jobs with five attempts through a dedicated
invoker identity that has `run.invoker` on the worker only. Cloud Scheduler uses
a separate invoker for hourly repair. The worker must verify authentication,
audience, and authorization, and must process retries idempotently.

Job dispatch uses durable outbox records written in the same transaction as the
data change. Reconciliation repairs missed work; queue configuration must
account for retries and exhausted attempts without repeating side effects or
losing ownership of recovery.

The worker accepts task execution and repair requests at separate private POST
routes. It verifies the Google-signed token, configured audience, verified email,
and the distinct invoker assigned to each route; Cloud Run IAM and ingress also
restrict invocation. The `GET /healthz` route reports process liveness without
exposing job data. Failed or early execution returns a retryable response.

The worker requires `WORKER_PROVIDER_MODE` and uses `WORKER_ORIGIN`,
`TASK_INVOKER_EMAIL`, `REPAIR_INVOKER_EMAIL`, `CLOUD_TASKS_QUEUE`, and a
server-only `WORKER_DATABASE_URL`. The worker pool has
one connection and must be included in the Neon connection budget before use.
The [Terraform runtime option](terraform.md#resource-definitions) supplies
these settings and a pinned database-secret reference when explicitly enabled.
Provider mode must be explicitly selected; offline mode binds to loopback and
refuses authentication and delivery until local job integration is available.
Repair handles at most 20 records per request with a five-second dispatch timeout
and logs only aggregate counts. The worker entry point currently rejects task
execution because automatic moderation requires the accepted scoring contract,
verification and history, moderator controls, and publication/privacy checks.
Do not unpause the repair schedule or connect a live assessment workflow until
those gates and the separate deployment review are complete.

Each Cloud Tasks name contains the database job ID and delivery generation. An
already-existing task name is accepted only after a full provider lookup confirms
the intended target, identity, body, and exact durable schedule. A missing,
uninspectable, or differently scheduled task is an uncertain result, not proof
of successful dispatch. A provider may change a task's reported schedule while
retrying or normalize a past schedule; this conservative check can therefore
require investigation even for a legitimate task. Validate actual provider
behavior in separately authorized isolated staging before enabling delivery.
The runtime needs
queue-scoped create and full-view access; that access can expose task payloads,
so payloads contain only the job ID and must remain private. Task creation uses
short-lived application-default credentials and an explicit invoker identity.

## Media and secrets

Separate buckets hold pending uploads, approved media, and backups. Buckets use
uniform access, public access prevention, versioning, and deletion protection;
approved content is served through an explicit delivery boundary rather than
unrestricted bucket access. Pending media and backups remain private.

Signed uploads must be short-lived and scoped to an object, size, and expiry.
Encryption at rest and restricted backup access protect stored data. Secret
Manager holds environment-specific credentials, and each identity can access
only its required secret versions. Operators should rotate credentials and
review the access audit records.

## Media access and cleanup

Media access separates private draft uploads from approved public previews.
The server authorizes upload access, the publishing process binds approved
previews to their exact revisions, and the cleanup worker removes eligible
temporary generations without disrupting active drafts or review.

The server must authorize the author or guest against the draft before issuing
upload access. It must choose an opaque object name, restrict the authorization
to the pending bucket and that object, and use a short expiry and a server-enforced
size limit. A signed URL is a bearer credential, not proof of ownership; avoid
logging it or returning it in public data. A resumable upload session URI is also
a bearer credential, and its lifetime must be considered separately from the
initial signed request. Google documents these properties in its
[signed URL guide](https://cloud.google.com/storage/docs/access-control/signed-urls).

The implementation must enforce the size limit at the storage or upload
boundary, not just trust a client-supplied size. A
[signed POST policy](https://cloud.google.com/storage/docs/authentication/signatures#policy-document)
can constrain a content-length range; a PUT URL must sign and require Cloud
Storage's `x-goog-content-length-range` header. The server must also validate the
uploaded bytes and bind the exact object generation to the draft before accepting
it for review. Allowed formats, size limits, expiry, and the resumable protocol
remain product decisions and need a reviewed contract before enabling uploads.

The server package's `createPendingUploadUrl` signs a PUT URL with an exact
content type, byte range, and create-only generation precondition. Its
`createPendingUpload` helper also signs a POST form. Both select a random pending
object and expire within 15 minutes. The caller must authorize the draft first, choose reviewed
type and size limits, persist the allocation before returning the form, and keep
the response private. The signer must have create-only access to the pending
bucket and must not be able to overwrite objects; the form itself does not enforce
that identity's permissions. Cleanup must not delete an allocated object while
its authorization remains valid, because the bearer could otherwise create it
again. Neither method is a resumable upload session, validates file contents, or
establishes a public preview.

The opt-in `enable_media_access` Terraform setting defines a dedicated signer
with object-creation access to the pending bucket, gives the web identity token
creation access to that signer, and grants web read access to the approved bucket.
The token-creator role can impersonate the signer as well as sign blobs, so
operators must check the signer's inherited permissions before authorizing a live
plan.
The `createUploadSigningStorage` helper accepts a trusted source credential and
uses that dedicated same-project signer through service-account impersonation;
it does not require a downloaded private key.
For browser form uploads, `upload_allowed_origins` configures CORS only on the
pending bucket, allowing POST and PUT with the required headers from the listed
exact origins. The empty default
allows no origins; operators must review any change to an existing bucket's CORS
before applying it.

The [staging media procedure](../policies/media-staging-procedure.md) identifies
the resources, their owning configuration, and their Terraform state.

The delivery boundary must check that the idea and exact media revision remain
approved before serving an immutable versioned preview. It must not expose the
pending bucket, unapproved originals, or arbitrary object generations. Withdrawal,
replacement, and removal must revoke access to older previews and invalidate
cached copies; an immutable URL alone does not provide revocation. The
[Hosting cache guide](hosting-cache.md) describes the related cache boundary.

The web endpoint `GET /api/media/{preview-id}` reads a generation only when its
preview row is published and the idea, exact current revision, and revision
review are approved. It rechecks that state after reading the object, validates
the returned generation, object size, and image signature, and returns
`private, no-store` to avoid leaving a withdrawn preview in a shared cache. It
supports generated JPEG, PNG, and WebP previews; it does not publish previews or
authorize original uploads.
The endpoint requires a database URL, distinct
`NUXT_APPROVED_MEDIA_BUCKET` and `NUXT_PENDING_MEDIA_BUCKET` settings, an explicit
`NUXT_MEDIA_PROVIDER_MODE`, and a
positive `NUXT_MEDIA_PREVIEW_MAX_BYTES` no greater than 16 MiB. That ceiling
protects server memory; the publishing workflow uses reviewed product
limits and must ensure the approved bucket contains only validated previews.

Only the trusted publishing workflow may insert or publish preview rows. It
must bind the exact approved revision and storage generation, revoke superseded
rows, and prevent the web runtime from writing publication state; the endpoint
does not substitute for those controls. Storage errors produce a generic `503`,
while absent, unpublished, withdrawn, or superseded previews return `404`.

Cleanup must preserve active drafts, review material, approved media, and any
objects subject to retention or legal holds. Before deleting a temporary object,
the worker must coordinate with draft and review updates so an object cannot gain
a reference between the eligibility check and deletion. It must check the
durable reference and expiry and use a generation precondition so a concurrent
replacement is not deleted. Failed deletes must be retried and reported without
logging media or signed credentials.
Operators must choose and document retention periods and a recovery owner before
enabling cleanup.
The server's `deletePendingUploadGeneration` helper deletes only an explicitly
named pending object generation with a generation-match precondition. Its caller
must hold the exclusive cleanup claim and perform the reference and expiry checks;
the helper does not make those decisions or schedule cleanup.
Both preview reads and cleanup preserve the complete generation ID in requests,
including values larger than JavaScript's safe integer range.

With object versioning, deleting a live object can leave a noncurrent generation,
and soft-delete retention can keep deleted generations longer. Operators must
account for both when verifying cleanup and privacy retention, and must not
restore a withdrawn preview to public access. See Google's
[object versioning guide](https://cloud.google.com/storage/docs/object-versioning)
and [lifecycle guide](https://cloud.google.com/storage/docs/lifecycle).

Reviewers should use synthetic files in an isolated test environment to verify
all of these outcomes:

1. An unauthorized caller cannot obtain upload access or read a pending object;
    an authorized caller can upload only the scoped object within its expiry and
    size limit.
2. Expired access, an oversized file, an altered object name, and an invalid file
    are rejected; retries and interrupted uploads preserve the intended draft.
3. Only the approved version is public; replacement or withdrawal removes access
    to prior versions through both the origin and any configured cache.
4. Cleanup removes only eligible test-owned generations, preserves referenced
    objects and holds, and records failures for retry. Inspect noncurrent and
    soft-deleted generations according to the test environment's retention.

Reviewers should record the environment, object generations, results, and cleanup
evidence without recording signed URLs, file contents, or secrets. They should
use only isolated resources and follow the authorized environment's cleanup
procedure; if safe cleanup is unavailable, retain the test resources and record
the gap.

## Identity and deployment boundaries

Runtime identities must not have project Owner, identity and access management
(IAM) administration, broad secret access, or backup deletion rights. Database
runtime and migration roles are separate; operators should use custom roles when
predefined roles exceed the required operations.

Deployment identity uses short-lived federation constrained by immutable
repository and organization identifiers, the approved workflow, and protected
ref/environment. Development and production deploy identities are separate, with
production environment approval. Registry writes, deployment rights, and
`iam.serviceAccounts.actAs` must be restricted to the relevant resources.

Build, deploy, migration, and infrastructure administration are distinct duties.
Operators should use direct federated access where supported and service-account
impersonation only where needed. Long-lived service-account keys must not be
issued.

## Regions and provider integrations

Regional Google services use `us-central1` where supported; Hosting's CDN has no
selectable regional edge. Neon is a separate provider and must not be assumed to
share a location with Google services. When you check cross-provider latency,
you should measure both cold and warm requests and set limits on queries,
connection pools, and transferred payloads.

Maps browser keys are public identifiers restricted by allowed HTTP referrers
and APIs; server keys have separate API and environment restrictions. The
application must bound map traffic, uploads, queue retries, and optional
provider work with explicit workload limits.

Gemini remains disabled unless its specific use, data handling, eligibility,
terms, and access have been resolved through a reviewed change. Enabled
processing must bound requests and tokens and review grounding behavior. Maps,
Gemini, and content assessment providers have distinct processing and retention
terms; provider use must not be inferred from another service's configuration.

The [moderation policy](../policies/moderation-policy.md) defines Natural
Language and Vision assessment behavior. Before using an integration, you should
verify its provider regions, data handling, and what the returned values mean.
