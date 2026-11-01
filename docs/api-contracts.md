# API contracts and authorization

This is the baseline for same-origin Cloud Run web APIs. The current API has
only health and published-idea reads. It does not yet authenticate users or
provide mutations, pagination, or idempotency storage. Feature issues implement
and test those capabilities; this document does not claim they exist today.

## Exposure and validation

- Treat requests, identifiers, provider data and generated text as untrusted.
  Validate type, format, size and allowed values at the server boundary before
  using them. Reject unknown writable fields rather than spreading request data
  into database records. Use parameterized queries.
- A public DTO is an explicit allowlist, not a database row with a few fields
  removed. The current published-idea DTO contains only `title` and
  `description`, and only when both idea and revision are approved. Private
  author emails, ownership/claim information, pending media, unapproved content
  and moderator-only data must never enter public API, SSR or cached responses.
  Private owner and moderator DTOs must be separately defined and projected
  only after the relevant server-side authorization. Future fields require a
  privacy review and tests using synthetic private sentinels.
- Public GET and HEAD operations must be side-effect free. Never implement a
  mutation through a read, a method-override header, or an unguarded alternate
  route. Do not trust client-supplied roles, user IDs or forwarded identity
  headers as proof of identity.

## Fail-closed mutations

The web server middleware currently rejects every method other than GET and
HEAD, and rejects method-override headers, before route handlers run. The denial
is `403` with `Cache-Control: private, no-store`. There are no exceptions,
including for a bearer token: token verification and policies do not exist yet.
This deliberately prevents even legitimate writes until a feature implements
the required boundary. The separate task handler must authenticate its callers
and authorize operations independently when implemented.

When introducing a mutation, replace or extend the guard in the same reviewed
change with a default-deny, server-side policy for that exact operation. Verify
Firebase credentials on the server for account operations; resolve ownership and
roles from trusted server data, then authorize the specific resource and action
before side effects. A guest operation needs its own explicitly reviewed
capability and abuse controls, not a bypass based on a missing user. Fail closed
on missing, invalid, expired or unavailable verification. Never rely on the UI,
Hosting or an assumed Cloud Run perimeter for authorization. Keep private
responses `private, no-store`; avoid leaking sensitive details in errors or logs.
Feature tests must exercise allowed and denied identities, cross-owner and
privilege cases, forged headers, failure paths and actual side effects at the
API/database boundary with isolated data. The current guard's production-server
smoke test establishes denial only, not future policy correctness.

## Conventions for future endpoints

When implementing an endpoint, document its contract using the
[API documentation standards](documentation-style-guide.md#api-contracts-and-reference-comments).

### Validation and errors

Validate every route, query and body against a documented schema. Return 400
for malformed input, 401 for missing/invalid authentication where authentication
is required, 403 for a verified principal lacking permission, 404 when a
resource is absent or its existence must be concealed, 409 for a conflicting
state or idempotency key, and a generic 5xx for server failures.

Existing Nuxt errors expose `statusCode` and `statusMessage`; do not expose stack
traces, credentials or raw database/provider errors.

### Pagination

List endpoints use a bounded page size and an opaque cursor with a stable,
deterministic ordering and tie-breaker. Validate cursor and limit; apply the
same authorization and filters on every page. Do not put private data
in a cursor or assume encoding makes it secret.

### Idempotency

Retryable mutations accept a bounded client idempotency key scoped to the
authenticated principal or reviewed guest capability and operation. Store a
canonical request fingerprint and result durably and atomically with the
state change; concurrent retries with the same key and payload return the same
result without repeating side effects. Reject reuse with different payloads.

An in-memory cache alone is insufficient. Each implementing issue must test
concurrent retries, conflicts and recovery.
