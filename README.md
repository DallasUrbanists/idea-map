# Idea Map

Idea Map is a community project for sharing and exploring ideas to improve the
places where we live. If you want to contribute, you can run a local checkout
with synthetic data and no production credentials, then use the repository map
below to find the code and guidance for your change.

- [What you can try](#what-you-can-try)
- [Run locally](#run-locally)
- [Find your way around](#find-your-way-around)
- [Contribute and plan](#contribute-and-plan)
- [License and policies](#license-and-policies)

## What you can try

Idea Map brings community ideas into a map and presentation experience. The
[product vision](https://github.com/DallasUrbanists/idea-map/wiki/Product-Vision-and-Scope)
explains the intended experience, and the
[open issues](https://github.com/DallasUrbanists/idea-map/issues) track
implementation status.

The selected stack combines Vue and Nuxt with TypeScript on Node.js, using pnpm
workspaces. PostgreSQL with PostGIS stores authoritative geographic and content
data through Drizzle; Firebase provides authentication and scoped real-time
projections. Reka and Storybook support UI development, and Playwright supports
browser checks. Docker runs local PostgreSQL and Firebase emulators. The
[architecture overview](docs/architecture/architecture-overview.md) explains
these boundaries and the Google Cloud hosting design.

## Run locally

The [development guide](docs/contributor-guides/development-guide.md) is the
canonical quickstart for a checkout with synthetic data and no production
credentials. Follow its [one-time setup](docs/contributor-guides/development-guide.md#one-time-setup-for-each-checkout)
for tools, dependencies, and local settings, then its
[session-start procedure](docs/contributor-guides/development-guide.md#start-of-each-work-session)
for services, readiness checks, migrations, Nuxt, and optional Storybook.

After startup, [the local app](http://127.0.0.1:3000) displays the Idea Map heading
and an **Account** link. The optional component preview opens at
[local Storybook](http://localhost:6006). These are the expected quickstart
results; feature-specific validation belongs in the
[testing guide](docs/contributor-guides/testing-guide.md).

The guide also covers [synthetic fixtures](docs/contributor-guides/development-guide.md#local-synthetic-fixtures)
and their scoped cleanup, [troubleshooting](docs/contributor-guides/development-guide.md#ports-and-troubleshooting),
and [session shutdown](docs/contributor-guides/development-guide.md#end-of-each-work-session),
including which data persists and which emulator records are lost.

## Find your way around

These locations separate application code, reusable packages, and project tools:

| Location | Contents |
| --- | --- |
| [`apps/web`](apps/web/) | Nuxt browser UI, server rendering, and same-origin APIs |
| [`apps/worker`](apps/worker/) | Background task execution and reconciliation |
| [`packages/contracts`](packages/contracts/) | Shared framework-independent types |
| [`packages/server`](packages/server/) | Server-only database schema and integrations |
| [`packages/street-renderer`](packages/street-renderer/) | Street-diagram rendering core |
| [`packages/streetmix`](packages/streetmix/) | Generation contracts and provider adapters |
| [`dev`](dev/) and [`scripts`](scripts/) | Local services, fixtures, and validation helpers |
| [`infra`](infra/) | Infrastructure definitions and isolated environment tooling |
| [`docs`](docs/README.md) | Contributor guides, architecture, design, policies, and migration evidence |

## Contribute and plan

Start with [CONTRIBUTING.md](CONTRIBUTING.md) to choose work, check ownership,
validate a change, and open a pull request. The
[testing guide](docs/contributor-guides/testing-guide.md) explains focused checks;
the [documentation style guide](docs/contributor-guides/documentation-style-guide.md)
provides the checklist for documentation-only changes. You can ask maintainers
for help through a relevant issue without including credentials or private data.

Use the [repository Projects](https://github.com/DallasUrbanists/idea-map/projects)
to follow work, the [Developer Experience project](https://github.com/orgs/DallasUrbanists/projects/5)
for contributor tooling, and the [wiki](https://github.com/DallasUrbanists/idea-map/wiki)
for product and planning context. The [roadmap](https://github.com/DallasUrbanists/idea-map/wiki/Roadmap-and-Milestones)
explains priorities.

The designated destinations are `mapmy.town` for the production app,
`storybook.mapmy.town` for the separate production Storybook, and `ideam.app`
for staging. These names are environment destinations, not confirmation that
a particular feature or deployment is live; local setup does not deploy to them.

## License and policies

Repository code is licensed under [Apache License 2.0](LICENSE). Content handling
and use of the service are governed separately by the
[Terms of Use](docs/policies/terms-of-use-policy.md),
[Privacy Policy](docs/policies/privacy-policy.md), and
[moderation policy](docs/policies/moderation-policy.md).
