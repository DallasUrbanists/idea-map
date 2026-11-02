# Vue and Nuxt architecture

When you change a page or add an endpoint, it helps to know what runs in the
browser and what stays on the server. This guide explains how Vue and Nuxt
organize Idea Map's pages, components, rendering, and configuration. The
[development guide](../contributor-guides/development-guide.md) has session
commands, and the [API policy](../policies/api-policy.md) sets request rules.

The following contents links navigate within this guide:

- [Application and rendering](#application-and-rendering)
- [Configuration and identity](#configuration-and-identity)
- [Components and styles](#components-and-styles)

## Application and rendering

Nuxt supplies server-side rendering (SSR), server routing, and runtime
configuration; Vue and Vue Router supply component and navigation behavior. The
web package pins compatible versions in its
[manifest](../../apps/web/package.json). Nuxt includes approved idea content and
social metadata in the initial HTML, so readers and crawlers can receive that
information without running browser code.

The application lives under `apps/web/app`, with pages in `pages`, shared
components in `components`, and browser-auth composables and plugins beside
them. Server API handlers and middleware live under `apps/web/server`. Reusable
domain contracts and server-only integrations remain in their workspace
packages.

## Configuration and identity

The [Nuxt configuration](../../apps/web/nuxt.config.ts) separates private
runtime settings from `runtimeConfig.public`. Database connections, API secrets,
and Admin credentials must remain server-only. Public Firebase identifiers
configure the browser software development kit (SDK); they must not include
private credentials.

Native `pnpm dev` loads the root `.env`; Compose passes it to the tools
container with internal service-address overrides. The exact configured session
origin must match the browser origin. The [Firebase guide](firebase.md) explains
how the SDK and emulators work together; the API policy explains cookie
verification and session mutation checks.

## Components and styles

The application loads `apps/web/src/styles/tokens.css` once through Nuxt's `css`
configuration. Project-owned components use scoped CSS, semantic classes, and
the [design system](../design/design-system.md). You should use native elements
for simple responsibilities and wrap selected [Reka primitives](reka.md) behind
stable component contracts.

You should look for existing components in [Storybook](storybook.md) and verify
loading, empty, error, disabled, keyboard, and responsive states. Browser
configuration must not bypass server authorization or expose private content in
SSR output, shared caches, or generated previews.
