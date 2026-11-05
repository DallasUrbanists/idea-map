# Hosting routes and public HTML caching

Firebase Hosting is a service for delivering web content and routing requests to
an application. A cache stores copies of responses so they can be reused for
later requests. This guide helps contributors and operators understand Idea Map's
Hosting configuration and public HTML cache policy. The separate staging
deployment and its limits are described in
[the staging guide](../contributor-guides/ssr-staging.md).

The following contents links navigate within this guide:

- [Routing and prerequisites](#routing-and-prerequisites)
- [Cache and withdrawal behavior](#cache-and-withdrawal-behavior)
- [Validation](#validation)

## Routing and prerequisites

`firebase.dev.json` and `firebase.prod.json` configure serving the Nuxt build's
`apps/web/.output/public` files and rewrite unmatched requests to the corresponding
`idea-map-web-dev` or `idea-map-web-prod` Cloud Run service in `us-central1`.
`firebase.staging.json` serves assets extracted from the staged image and routes
other requests to the separate `idea-map-ssr-staging` service.
HTML and Nuxt payload files in *JavaScript Object Notation (JSON)* are excluded
from static hosting so page and API requests reach the server. Firebase gives
existing static files priority over rewrites; operators should review the build
output for paths that could shadow routes and use the same reviewed build for
the Hosting assets and server image.

The Terraform foundation specifies internal-only Cloud Run ingress. A separate
[*server-side rendering (SSR)* staging configuration](../contributor-guides/ssr-staging.md) provides
public access to an isolated test web service; the worker and production
foundation remain internal-only.
See the [Terraform architecture guide](terraform.md) for resource and state management.

## Cache and withdrawal behavior

The server uses `Cache-Control: private, no-store` for dynamic responses,
including public idea pages, sessions, and errors. This default protects the
[immediate removal requirement](../policies/privacy-policy.md#retention-and-deletion)
and the [moderation policy](../policies/moderation-policy.md#revisions-and-publication).
A cache that retains public content requires an effective invalidation mechanism
before it can be used for real user content.

Guarded idea pages also use `private, no-store` in isolated staging, even when
the staging cache flag is enabled. A shared copy could bypass the public-access
gate after a removal or journal failure. Older deployed revisions and previously
cached responses can still serve content, so isolate old revisions and allow
existing cache entries to expire or verify their purge before relying on the
gate. Error responses explicitly use `no-store`, including `404 Not Found`
responses, to avoid Firebase Hosting's default dynamic 404 caching.

Firebase Hosting forwards the `__session` cookie to Cloud Run and includes cookie
and authorization headers in its dynamic cache key. Other cookies are stripped
before reaching the backend. The application still treats any cookie it receives
as private. See Firebase's [cache behavior](https://firebase.google.com/docs/hosting/manage-cache)
and [rewrite configuration](https://firebase.google.com/docs/hosting/full-config).

## Validation

Contributors can run the [published-page test](../contributor-guides/testing-guide.md#database-tests) with a
disposable seeded database after building. It checks no-store responses with the
default and isolated staging configurations, crawler metadata, private and credential-bearing
responses, and the origin response after withdrawing the synthetic idea. It restores that fixture and does not
simulate a CDN.

An isolated staging check on November 1, 2026 verified the Hosting rewrite, static
assets, crawler metadata, `__session` forwarding, private session responses, and
a CDN cache hit using synthetic fixtures. After the synthetic public idea was
withdrawn, the origin returned `404 Not Found` immediately and the CDN was
observed returning that status after 63 seconds; checks ran at five-second
intervals. The fixture was restored. This predates the guarded no-store change
and is not evidence that the new behavior has been deployed or verified at
every CDN edge.
