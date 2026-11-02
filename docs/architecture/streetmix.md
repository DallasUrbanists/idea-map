# Streetmix architecture

Generating a street design connects an accepted idea to a provider and brings
the result back into Idea Map. This guide helps you understand which work
belongs in the application and which belongs in the reusable generation
package. The [package README](../../packages/streetmix/README.md) describes its
input, result, and provider contracts.

The following contents links navigate within this guide:

- [Package and application responsibilities](#package-and-application-responsibilities)
- [Media and provider boundary](#media-and-provider-boundary)

## Package and application responsibilities

The package uses generation rules supplied by its caller to turn an accepted
interpretation and revision into a street plan. An injected provider adapter
returns a design tied to that source revision. The package does not load
secrets, authorize users, persist designs, make application HTTP calls, or
manage retries.

The application must supply trusted credentials, authorize generation and
replacement, enforce timeouts and idempotency, resolve concurrent replacement,
and preserve private data and provenance. Provider failures are passed back to
the caller to handle.

## Media and provider boundary

Navigable provider URLs must use explicit origin allowlists. Thumbnail relays
and remote media retrieval must bound input and output and must not forward
application credentials to third-party URLs. Pending designs and previews remain
private until publication authorizes the exact revision and media.

Provider software, API access, artwork, and generated content have distinct
terms. You should verify the applicable permissions and attribution instead of
assuming the project's software license covers them. The
[Google Cloud guide](google-cloud.md#regions-and-provider-integrations) explains
the conditions for enabling Gemini.
