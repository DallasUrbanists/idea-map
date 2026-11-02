# Agent operating guide

If you're working on Idea Map as an AI agent, this is where to start. These
shared rules help you find project guidance, make careful changes, and hand off
work that others can review.

The following contents links navigate within this guide:

- [Before changing files](#before-changing-files)
- [Make focused changes](#make-focused-changes)
- [Protect data and operations](#protect-data-and-operations)
- [Write developer documentation](#write-developer-documentation)
- [Validate and hand off](#validate-and-hand-off)
- [Finish a work session](#finish-a-work-session)

## Before changing files

Agents must prepare for each task with these checks:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md), use the
    [documentation index](docs/README.md) to find task-specific guidance, and
    follow more specific instructions in affected directories.
2. Inspect the issue, its dependencies, and the current repository state.
    Preserve existing user work; never reset or overwrite it.
3. Compare the implementation with documented requirements and ask when a
    consequential requirement is unclear instead of inventing product behavior.
4. Complete the [development setup](docs/contributor-guides/development-guide.md#one-time-setup-for-each-checkout)
    before running code checks or the app, including dependencies and the root
    `.env`. Documentation-only edits need no setup or running services.

Agents must run repository commands from the root containing
`pnpm-workspace.yaml`. When services are needed, follow the
[session-start steps](docs/contributor-guides/development-guide.md#start-of-each-work-session).

## Make focused changes

Agents must follow these rules while making changes:

- Respect the [workspace boundaries](docs/architecture/architecture-overview.md#workspace-boundaries)
    and read the relevant architecture guide before changing infrastructure or
    development helpers.
- Inspect existing components, Storybook examples, and the
    [design system](docs/design/design-system.md) before adding interface code.
    Reuse documented component APIs and project CSS and tokens; do not add Tailwind.
- Check keyboard access, responsive layouts, and loading, empty, and error states.
- Keep shared agent rules in this file and make tool-specific entry points link
    here rather than copy policy.

## Protect data and operations

Agents must protect private information and shared services:

- Use synthetic fixtures and disposable test services, never production data.
- Keep secrets, credentials, and private data out of code, logs, prompts, and
    commits, and keep private or unpublished content out of public responses.
- Validate and authorize operations on the server.
- Preserve data and document compatibility and recovery for migrations and
    destructive actions, using isolated test databases.
- Obtain explicit authorization before deployment, provisioning, publication,
    permission changes, or access to production systems.

## Write developer documentation

Agents must follow the [documentation style guide](docs/contributor-guides/documentation-style-guide.md)
when writing or reviewing documentation, including instructions for agents.
Describe the intended system as the project standard; historical records in the
[migration directory](docs/v1-migration/README.md) do not define current requirements.

For a new or changed user task, agents must follow the
[user-guide writing rules](docs/contributor-guides/documentation-style-guide.md#user-guides)
and add or update the matching how-to guide in the same change.

## Validate and hand off

Agents must follow the [pull-request review guide](docs/contributor-guides/pull-request-review-guide.md)
when reviewing pull requests. For their own changes, complete these checks:

1. Choose checks from the [testing guide](docs/contributor-guides/testing-guide.md),
    testing meaningful behavior and risks at the lowest useful layer and running
    required code and integration checks.
2. For documentation-only changes, review content, links, and commands using the
    [documentation checklist](docs/contributor-guides/documentation-style-guide.md#documentation-review-checklist).
    No application build or services are needed.
3. Investigate visual differences and get intended design changes reviewed before
    updating baselines.
4. Review the complete diff and keep it focused on the requested change.
5. Report checks actually run, their results, and validation gaps using the
    [review-description standards](docs/contributor-guides/documentation-style-guide.md#review-descriptions-and-release-notes).
    Follow the contribution workflow and report security-sensitive problems privately.

## Finish a work session

Agents must stop services they started using the
[shutdown steps](docs/contributor-guides/development-guide.md#end-of-each-work-session).
For Docker sessions, run `pnpm dev:stop` and `pnpm dev:status` from the same
checkout to stop only its services and confirm they stopped. If no services
were started, no shutdown commands are needed.
