# Resend architecture

Service emails help people keep up with activity in Idea Map. This guide
explains how Resend connects to the worker, how credentials stay private, and
how delivery handles retries. The
[Privacy Policy](../policies/privacy-policy.md) explains how recipient
information is handled.

The following contents links navigate within this guide:

- [Credentials and environments](#credentials-and-environments)
- [Delivery boundary](#delivery-boundary)

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
