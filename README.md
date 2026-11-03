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

The local app opens an Idea Map landing page with an **Account** link. The
checkout includes account flows, server APIs, database migrations, synthetic
fixtures, and component previews in Storybook. A successful startup does not
mean every product workflow is available: the complete map exploration and
presentation experience remains planned work. Use the
[open issues](https://github.com/DallasUrbanists/idea-map/issues) to check feature
progress and the [product vision](https://github.com/DallasUrbanists/idea-map/wiki/Product-Vision-and-Scope)
to understand the intended experience.

The selected stack combines Vue and Nuxt with TypeScript on Node.js, using pnpm
workspaces. PostgreSQL with PostGIS stores authoritative geographic and content
data through Drizzle; Firebase provides authentication and scoped real-time
projections. Reka and Storybook support UI development, and Playwright supports
browser checks. Docker runs local PostgreSQL and Firebase emulators. The
[architecture overview](docs/architecture/architecture-overview.md) explains
these boundaries and the Google Cloud hosting design.

## Run locally

Use a terminal at the repository root, which contains `pnpm-workspace.yaml`.
The package commands below work in Bash and PowerShell. You need Git,
Node **24.22.1**, pnpm **11.25.0**, and a running Docker installation with Compose;
the [development guide](docs/contributor-guides/development-guide.md#one-time-setup-for-each-checkout)
provides tool installation, configuration details, and troubleshooting.

1. Clone the repository and enter the new checkout:

    ```sh
    git clone https://github.com/DallasUrbanists/idea-map.git
    cd idea-map
    ```

2. Install the locked dependencies:

    ```sh
    pnpm install --frozen-lockfile
    ```

3. Copy [`.env.example`](.env.example) to `.env` at the repository root using
    your editor or file manager; preserve an existing `.env` rather than
    overwriting it. Keep the synthetic demo settings for this quickstart and
    never add real credentials or commit `.env`.
4. Follow the [session-start procedure](docs/contributor-guides/development-guide.md#start-of-each-work-session)
    to start services, inspect their status, check readiness, apply migrations,
    and start Nuxt, in this order:

    ```sh
    pnpm dev:services
    pnpm dev:status
    pnpm dev:check
    pnpm dev:db:migrate
    pnpm dev
    ```

5. Open [the local app](http://127.0.0.1:3000) after Nuxt reports it is ready;
    expect the Idea Map heading and **Account** link. Keep the terminal running
    while you work, and use the exact `127.0.0.1` origin from the demo settings.

The first service start can take several minutes to download images and emulator
artifacts. Readiness checks must pass before you continue; migrations prepare
an empty database without adding demo ideas. If a command fails, use the
[development guide](docs/contributor-guides/development-guide.md) to diagnose it
before advancing to the next step.

Optional: run `pnpm dev:storybook` in another terminal to open the component
preview at [local Storybook](http://localhost:6006). To explore synthetic data,
follow the [fixture instructions](docs/contributor-guides/development-guide.md#local-synthetic-fixtures),
including their scoped cleanup; the basic quickstart does not create fixture
records.

When you finish, press Ctrl+C in each terminal running Nuxt, Storybook, or a log
viewer. Run these commands from the same checkout to stop its background
services and confirm no containers remain running for its Compose project:

```sh
pnpm dev:stop
pnpm dev:status
```

Stopping services preserves the PostgreSQL volume and downloaded emulator
artifacts. Auth accounts and Firestore emulator records are held in memory and
are lost on shutdown. See the [shutdown guide](docs/contributor-guides/development-guide.md#end-of-each-work-session)
for details; do not delete database volumes or other checkouts' services as
routine cleanup.

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
