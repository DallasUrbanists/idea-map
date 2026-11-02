# Google Cloud architecture

Idea Map's web app, background jobs, and stored media rely on several Google
Cloud services working together. This guide helps you follow those connections
and understand which identities can access each resource. You can find resource
management details in the [Terraform guide](terraform.md) and account handling
in the [Firebase guide](firebase.md).

The following contents links navigate within this guide:

- [Hosting and compute](#hosting-and-compute)
- [Tasks and reconciliation](#tasks-and-reconciliation)
- [Media and secrets](#media-and-secrets)
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
