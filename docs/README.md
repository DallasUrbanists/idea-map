# Idea Map documentation

Whether you're using Idea Map or helping build it, these guides can help you
get started. You'll find instructions for using the app, contributing to the
project, and understanding how it works.

The following contents links navigate within this guide:

- [Contributor guides](#contributor-guides)
- [User guides](#user-guides)
- [Architecture](#architecture)
- [Design](#design)
- [Policies and procedures](#policies-and-procedures)
- [Migration history](#migration-history)

## Contributor guides

You should start with [CONTRIBUTING.md](../CONTRIBUTING.md) and use these guides
for project work:

| Guide | Purpose |
| --- | --- |
| [AI contributor guide](contributor-guides/ai-agent-guide.md) | Choose a tool, load project instructions, and review assisted work |
| [Agent operating guide](../AGENTS.md) | Shared rules for coding agents working on the project |
| [Development guide](contributor-guides/development-guide.md) | Setup, configuration, native/container sessions, shutdown, and troubleshooting |
| [Testing guide](contributor-guides/testing-guide.md) | Required checks, package/database tests, and manual/automated authentication checks |
| [SSR staging guide](contributor-guides/ssr-staging.md) | Operate and validate the isolated server-rendering staging environment |
| [Pull-request review guide](contributor-guides/pull-request-review-guide.md) | Check behavior, documentation, and evidence, and leave actionable feedback |
| [Documentation style guide](contributor-guides/documentation-style-guide.md) | Mandatory writing rules, audience boundaries, and documentation review |

## User guides

The [user-guide directory](user-guides/) contains nontechnical instructions for
actions people take in the application. Each Markdown filename follows
`how-to-<user-action>.md`, with a descriptive lowercase kebab-case action.

Authors should explain user-facing prerequisites, steps, results, and recovery
options without developer commands, source paths, or architecture. Add or update
guides alongside user-facing feature changes once the interactions can be
described accurately; the empty directory is retained with `.gitkeep`.

## Architecture

The [architecture overview](architecture/architecture-overview.md) explains
system data flows, package boundaries, environments, and recovery. You can find
details about each platform in these guides:

| Area | Guides |
| --- | --- |
| Runtime and workspace | [Node.js/TypeScript](architecture/nodejs-typescript.md), [pnpm](architecture/pnpm.md), [Vue/Nuxt](architecture/vue-nuxt.md) |
| user interface and browser verification | [Reka](architecture/reka.md), [Storybook](architecture/storybook.md), [Playwright](architecture/playwright.md) |
| Infrastructure | [Docker](architecture/docker.md), [Google Cloud](architecture/google-cloud.md), [Terraform](architecture/terraform.md), [Hosting cache](architecture/hosting-cache.md) |
| Identity and data | [Firebase](architecture/firebase.md), [PostgreSQL/PostGIS/Drizzle](architecture/postgresql-postgis-drizzle.md), [Neon](architecture/neon.md) |
| External services | [Resend](architecture/resend.md), [Streetmix](architecture/streetmix.md) |

## Design

The [design system](design/design-system.md) brings together tokens, themes,
component contracts, and accessibility expectations. The
[browser specimen](design/specimen.html) demonstrates those visual choices using
the project stylesheet.

## Policies and procedures

These policies explain how the app handles requests and content, and how
maintainers release changes:

| Document | Purpose |
| --- | --- |
| [API policy](policies/api-policy.md) | Authorization, validation, privacy, consent enforcement, pagination, and retries |
| [Moderation policy](policies/moderation-policy.md) | Content rules, approval timing, intervention, publication, and appeals |
| [Privacy Policy](policies/privacy-policy.md) | Personal-data handling, providers, retention, deletion, and requests |
| [Terms of Use](policies/terms-of-use-policy.md) | Submission rights, service license, consent, acceptable use, and reuse restrictions |
| [Release procedure](policies/release-procedure.md) | Changesets, validation, versioning, release authorization, and recovery |

## Migration history

The [migration history](v1-migration/README.md) contains predecessor
inventories, rights evidence, and capability comparisons. It does not describe
current behavior or establish current requirements; its README defines its
historical scope.
