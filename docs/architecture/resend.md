# Resend architecture

Service emails help people keep up with activity in Idea Map. This guide
explains how Resend connects to the worker, how credentials stay private, and
how delivery handles retries. The
[Privacy Policy](../policies/privacy-policy.md) explains how recipient
information is handled.

The following contents links navigate within this guide:

- [Credentials and environments](#credentials-and-environments)
- [Delivery boundary](#delivery-boundary)
- [Sending domain and secrets](#sending-domain-and-secrets)
- [Staging provider details](#staging-provider-details)
- [Delivery webhooks](#delivery-webhooks)

## Credentials and environments

Development and production use separate restricted provider keys and sending
domains. Development uses synthetic recipients and test delivery controls.
Provider credentials must remain in server-controlled secrets, never browser
bundles, URLs, fixtures, or logs.

## Delivery boundary

The worker sends authorized transactional messages and handles delivery failures
without exposing private details. Dispatch must tolerate retries without
duplicate side effects, following the
[API idempotency policy](../policies/api-policy.md#idempotency). Provider data
handling, retention, regional terms, and access must be verified for the actual
integration.

Exact message types, templates, and provider adapter contracts remain unresolved
until their responsibilities are defined in a reviewed documentation change.
Firebase handles verification and password-reset emulator links separately; the
[Firebase guide](firebase.md) explains those links.

## Sending domain and secrets

The foundation does not configure a Resend domain, DNS records, secret versions,
or a running mail sender. Before enabling delivery, an authorized operator should select
separate development and production sending domains and verify their ownership,
DNS authority, provider region, terms, and access. Provisioning, DNS changes,
and permission changes require explicit authorization and a reviewed plan.

For each environment, the operator should create a restricted Resend sending key
and a separate webhook signing secret. Store their values in separate Secret
Manager secrets using an approved secret-entry method; do not place values in
Terraform variables, state, source control, logs, or browser configuration.
Grant only the sender access to the sending key and only the webhook verifier
access to its signing secret. Review inherited access, audit access, and rotate
each secret through a tested overlap and rollback procedure.

The foundation Terraform root can define two empty, environment-specific secret
containers and grant the worker access to the sending key and the web runtime
access to the webhook secret when `enable_resend_secrets` is explicitly set to
`true`. It does not create secret versions. An operator can set the numeric
`resend_webhook_secret_version` to reference a pinned version from the web
runtime; the empty default leaves that reference unset. Operators must review
naming, replication, ownership, inherited access, and the live plan before an
authorized apply. Terraform's deletion guard does not replace a recovery plan.

The DNS operator should use the records generated for the selected domain by
Resend, including its Sender Policy Framework (SPF) and DomainKeys Identified
Mail (DKIM) records. The operator should review the domain's Domain-based Message
Authentication, Reporting, and Conformance (DMARC) policy and alignment. Check
existing DNS records before making changes; avoid creating
conflicting SPF records or disrupting existing mail. After propagation, verify
the provider's domain status and inspect SPF, DKIM, and DMARC results on a
synthetic message sent to a controlled test mailbox. Record record names,
verification status, and date without recording credentials or recipient data.
Resend explains its [domain verification](https://resend.com/changelog/improved-dns-features)
and [verification status](https://resend.com/changelog/domain-verification-events).

## Staging provider details

On November 1, 2026, the maintainer confirmed `staging.ideam.app` as the test
sending domain and Namecheap as the DNS provider. The isolated Google Cloud
development project is `dallasurbanists-idea-map-dev`; the
[staging guide](../contributor-guides/ssr-staging.md) records its existing web
resources. The existing Resend team is `dallasurbanists`, and Resend reported
the domain verified with sending enabled in North Virginia (`us-east-1`) on that
date. The Resend account had no API keys at the time of inspection.

The development project already contains Secret Manager containers named
`idea-map-staging-resend-api-key` and `idea-map-staging-resend-webhook-secret`.
On November 1, 2026, the maintainer stored version 1 of a sending-only Resend
key scoped to `staging.ideam.app`; the webhook secret had no version. Operators should
inspect ownership, effective access, and current versions before reusing them;
the optional foundation Terraform names differ and must not create duplicates
without a reviewed ownership decision.

The Namecheap zone already contains staging sending-related CNAMEs, a Resend
DKIM record, and a `_dmarc.staging` record with a monitoring-only policy. Resend
reported its DKIM and both Forge SPF CNAMEs verified; DNS queries also returned the
SPF, DKIM, and DMARC records. The
`staging` CNAME also routes the existing site, so operators must preserve it and
compare provider-supplied records with the live zone before editing. Existing
records and provider status do not establish successful delivery.

On November 1, 2026, a synthetic message to Resend's simulated delivery address
was accepted and reported delivered. An immediate retry with the same
idempotency key returned the same provider message ID. This test did not deliver
to an external mailbox or verify the deployed webhook. The synthetic message
remains in the Resend account's delivery history under the provider's retention.

## Delivery webhooks

The server package includes a Resend sender and delivery webhook verifier. The
web app accepts delivery events at `POST /api/webhooks/resend` and stores their
minimal metadata in PostgreSQL; no worker connects the sender to a message job
yet. The sender
requires a persisted request and stable idempotency key from its caller. A
successful submission means provider acceptance, not delivery; a network failure,
server error, or conflict has an unknown outcome. Resend retains idempotency keys
for only [24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys),
so the worker must reconcile uncertain outcomes rather than blindly retry later.
Operators must keep Resend SDK debug logging disabled to avoid exposing provider
response details.

The verifier checks the original raw request body and the provider's signature,
timestamp, and message ID before trusting an event. Resend documents
the [verification headers and SDK helper](https://resend.com/changelog/managing-webhooks-via-api).
Invalid signatures and stale requests must not update delivery state; request
bodies, signatures, and secrets must not appear in logs.

The verifier stores only the event ID, email ID, type, event time, and receipt
time. A unique event ID deduplicates concurrent deliveries before acknowledgement;
storage errors return `503` for retry. Events remain separate records, including
when they arrive out of order; operator-facing delivery views are not implemented.
Operators should monitor failed attempts, repair
the cause, and replay only after confirming the handler is idempotent. The
[API policy](../policies/api-policy.md#idempotency) defines retry expectations.

Once the sender and endpoint exist, reviewers should use provider fakes and
synthetic messages to check a valid event, invalid signature, stale timestamp,
duplicate event, out-of-order event, and retry after a persistence failure. In an
authorized isolated environment, reviewers should also verify a test-domain
message and delivery event, then remove only test-owned records and restore
temporary settings. Record any missing delivery or cleanup evidence; do not
claim provider verification from a fake alone.

The endpoint requires a private `NUXT_RESEND_WEBHOOK_SECRET` and the server's
`NUXT_DATABASE_URL`. It returns `503` when either is absent or persistence fails,
`400` for invalid signatures and malformed supported events, and `413` for bodies
over 256 KiB. The endpoint acknowledges verified unsupported event types without
storing them. Operators must apply the reviewed database migration and grant the
web runtime only the required access to `email_delivery_events` before enabling
the endpoint; the secret must come from the environment's authorized secret
delivery mechanism.

The webhook insert needs `INSERT` on `event_id`, `email_id`, `event_type`, and
`occurred_at`, and `SELECT` on `event_id` for the conflict check and returned ID.
An isolated database test verifies those column-level grants and rejects a read
of `email_id`; operators must separately review schema access and inherited
privileges for the runtime role.
