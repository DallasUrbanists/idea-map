# Hosting routes and public HTML caching

This guide explains the Firebase Hosting configuration and cache policy for
contributors and operators reviewing the web app. The separate staging deployment
and its limits are described in [the staging guide](../contributor-guides/ssr-staging.md).

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

The isolated synthetic staging service can opt in to a 60-second shared cache.
The runtime requires `NUXT_STAGING_HTML_CACHE=true`, the staging Firebase project,
the staging session origin, and the staging Cloud Run service name. Only a
successful `GET` or `HEAD` HTML render of an approved synthetic public idea
without a `Cookie` or `Authorization` request header or a `Set-Cookie` response
is eligible for `public, max-age=0, s-maxage=60, must-revalidate`. The response
varies on `Cookie` and `Authorization`; APIs and all other responses remain
private.

The staging origin reads the current published projection on each request, but
a cached copy can remain visible until its 60-second lifetime ends. Staging uses
synthetic data only, and its cache has no immediate purge mechanism. Error
responses explicitly use `no-store`, including `404 Not Found` responses, to
avoid Firebase Hosting's default dynamic 404 caching.

Firebase Hosting forwards the `__session` cookie to Cloud Run and includes cookie
and authorization headers in its dynamic cache key. Other cookies are stripped
before reaching the backend. The application still treats any cookie it receives
as private. See Firebase's [cache behavior](https://firebase.google.com/docs/hosting/manage-cache)
and [rewrite configuration](https://firebase.google.com/docs/hosting/full-config).

## Validation

Contributors can run the [published-page test](../contributor-guides/testing-guide.md#database-tests) with a
disposable seeded database after building. It checks the default and isolated
staging cache policies, crawler metadata, private and credential-bearing
responses, and the origin response after withdrawing the synthetic idea. It restores that fixture and does not
simulate a CDN.

An isolated staging check on November 1, 2026 verified the Hosting rewrite, static
assets, crawler metadata, `__session` forwarding, private session responses, and
a CDN cache hit using synthetic fixtures. After the synthetic public idea was
withdrawn, the origin returned `404 Not Found` immediately and the CDN was
observed returning that status after 63 seconds; checks ran at five-second
intervals. The fixture was restored. Operators should repeat these provider
checks after relevant changes; a single test does not prove behavior at every
CDN edge.
