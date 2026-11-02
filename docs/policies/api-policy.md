# API policy

An API change can affect who sees an idea and who can edit it. These rules
help you validate requests, protect private information, and handle retries
consistently across web endpoints and background jobs. Contributors should use
the [API writing rules](../contributor-guides/documentation-style-guide.md#api-contracts-and-reference-comments)
when documenting an endpoint.

The following contents links navigate within this guide:

- [Exposure and validation](#exposure-and-validation)
- [Fail-closed mutations](#fail-closed-mutations)
- [Sessions](#sessions)
- [Validation and errors](#validation-and-errors)
- [Pagination](#pagination)
- [Idempotency](#idempotency)
- [Submission consent and removal](#submission-consent-and-removal)

## Exposure and validation

The server must treat requests, identifiers, provider data, and generated text
as untrusted. It must validate type, format, size, and allowed values before
use, reject unknown writable fields, and use parameterized queries.

A public data transfer object lists exactly which fields a response can include.
The published-idea view exposes `title` and `description` only when both the
idea and its revision are approved. The server must exclude private emails,
ownership evidence, pending media, unapproved content, and moderator-only
information from public API, server-rendered, and cached responses.

Private owner and moderator views must have separate definitions and require
server-side authorization before projection. Before adding public fields, you
should review their privacy implications and test with synthetic private values
that make a leak detectable.

`GET` and `HEAD` operations must be side-effect free. The server must reject
method-override headers and must not trust browser-supplied roles, user
identifiers, or forwarded identity headers as proof of identity.

## Fail-closed mutations

The server must deny mutations unless an operation-specific policy explicitly
permits the resource and action. A bearer token alone must not bypass the
policy; the server must verify Firebase credentials and resolve ownership and
roles from trusted data before side effects. Guest operations must have explicit
capabilities and abuse controls rather than a missing-user bypass.

The middleware denies unsupported mutations with `403` and
`Cache-Control: private, no-store`. The session `POST` is explicitly handled by
its own origin and request checks. Other authorized operations must enforce
their exact policy at the server boundary, independently of user interface or
hosting controls.

The task handler must authenticate its caller and authorize each action
independently. Verification must fail closed for absent, invalid, expired, or
unavailable credentials. Private responses must use `private, no-store` and must
not expose sensitive error or log details.

You should test allowed and denied identities, cross-owner access, privilege
boundaries, forged headers, failure paths, and actual side effects with isolated
data. A test that only confirms default denial does not show whether
resource-specific permissions work correctly.

## Sessions

The account page uses a private `__session` cookie with the `HttpOnly`,
`Secure`, and `SameSite=Lax` attributes. The cookie lasts about 14 days. Session
creation verifies signatures and revocation and requires a recently minted
identity token. The browser refreshes claims and renews the cookie every 50
minutes, on focus, and on reconnect, retrying failures after one minute.

Session mutations must match the configured exact `Origin` and include the
required non-simple JSON request header. The endpoint must disable cross-origin
resource sharing (CORS). Logout clears that browser's session without revoking
other devices. Protected routes must check revocation, operation authorization,
and verified-email rules; the cookie alone must not grant private-data access.

## Validation and errors

The server must validate route, query, and body inputs against documented
schemas. It must return `400` for malformed input, `401` for missing or invalid
required authentication, `403` for insufficient permission, `404` for absent or
concealed resources, `409` for conflicting state or idempotency keys, and
generic `5xx` errors for server failures.

Nuxt errors expose `statusCode` and `statusMessage`. Error responses must not
include stack traces, credentials, or raw database/provider errors.

## Pagination

List endpoints must use bounded page sizes, opaque cursors, and stable ordering
with a deterministic tie-breaker. They must validate cursors and limits, apply
the same authorization and filters on every page, and exclude private data from
cursors; encoding must not be treated as encryption.

## Idempotency

Retryable mutations must accept bounded keys scoped to the authenticated
principal or explicit guest capability and operation. The database must store a
canonical request fingerprint and result atomically with the change; concurrent
retries with the same key and payload must return the same result without
repeated side effects. Reusing a key with another payload must be rejected.

An in-memory cache alone does not provide durable idempotency. You should test
concurrent retries, conflicts, and recovery.

## Submission consent and removal

The submission form must present an unchecked agreement on every submission,
including guest submissions, linked to the exact
[Terms of Use](terms-of-use-policy.md). Its label is:

> I agree to the Idea Map Terms of Use and confirm that I have the rights needed
> to submit this text and these photos.

The server must reject missing agreement and invalid terms versions before
acceptance. It must record the accepted version and server timestamp, preserve
them through retries and ownership claims, and keep referenced terms available.
Account signup must not replace submission agreement.

Removal handlers must verify requester authority and invalidate public media,
previews, and projections immediately after authorization. Stored data and
backups must follow the
[Privacy Policy](privacy-policy.md#retention-and-deletion); restoration must not
republish removed content.
