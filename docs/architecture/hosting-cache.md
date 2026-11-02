# Hosting routes and public HTML caching

This guide explains the Firebase Hosting configuration and cache policy for
contributors and operators reviewing the web app. The separate staging deployment
and its limits are described in [the staging guide](../contributor-guides/ssr-staging.md).

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

The server defaults dynamic responses to `Cache-Control: private, no-store`,
including session endpoints, errors, and routes added later. Only a successful
`GET` or `HEAD` HTML render of the approved public idea projection without any
`Cookie` or `Authorization` request header, and without a `Set-Cookie` response,
is eligible for `public, max-age=0, s-maxage=60, must-revalidate`. The browser
must revalidate; a shared cache can retain that response for up to 60 seconds.
The response varies on `Cookie` and `Authorization`. API responses remain
private and are not the shared HTML cache.

The origin server reads the current published projection on each request. Editing
or withdrawing an idea changes the next origin response, but an existing copy on
the *content delivery network (CDN)* can remain visible until its 60-second
lifetime ends. There is no immediate purge mechanism in this implementation.
Publishers should treat that delay as a publication constraint and should not
cache content requiring immediate withdrawal. Error responses explicitly use
`no-store`, including `404 Not Found` responses, to avoid Firebase Hosting's
default dynamic 404 caching.

Firebase Hosting forwards the `__session` cookie to Cloud Run and includes cookie
and authorization headers in its dynamic cache key. Other cookies are stripped
before reaching the backend. The application still treats any cookie it receives
as private. See Firebase's [cache behavior](https://firebase.google.com/docs/hosting/manage-cache)
and [rewrite configuration](https://firebase.google.com/docs/hosting/full-config).

## Validation

Contributors can run the [published-page test](../contributor-guides/testing-guide.md#database-tests) with a
disposable seeded database after building. It checks public HTML and crawler
metadata, private and credential-bearing responses, and the origin response
after withdrawing the synthetic idea. It restores that fixture and does not
simulate a CDN.

An isolated staging check on November 1, 2026 verified the Hosting rewrite, static
assets, crawler metadata, `__session` forwarding, private session responses, and
a CDN cache hit using synthetic fixtures. After the synthetic public idea was
withdrawn, the origin returned `404 Not Found` immediately and the CDN was
observed returning that status after 63 seconds; checks ran at five-second
intervals. The fixture was restored. Operators should repeat these provider
checks after relevant changes; a single test does not prove behavior at every
CDN edge.
