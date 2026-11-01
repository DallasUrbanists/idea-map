# Working on Idea Map with an agent

This document is for AI agents and the people working with them who want to make
safe, understandable changes to Idea Map. It explains how to prepare for work,
choose where to make changes, write useful documentation, check results, and
finish a work session.

AI assistance is optional. The human contributor remains responsible for the
change, its review and validation.

## One-time setup

This section is for those who want to prepare a repository checkout before
working on it for the first time.

1. Read [CONTRIBUTING.md](../CONTRIBUTING.md) to understand the contribution workflow.
2. If the task requires running the app or code checks, complete the [development setup](development.md#one-time-setup-for-each-checkout), including dependencies and the root `.env` file. Documentation-only edits need no tool setup.

There is no separate agent-specific installation. Run repository commands from
the root folder containing `pnpm-workspace.yaml`.

## Start of each work session

This section is for those who want to understand the task and prepare the
services their work needs.

1. Read [AGENTS.md](../AGENTS.md), this guide, and any more specific instructions in the directories you will change.
2. Inspect the issue, its dependencies and the current repository state. Preserve existing user work; never reset or overwrite it.
3. Confirm the intended behavior against the current implementation. Ask when a consequential requirement is unclear instead of inventing product behavior.
4. If the task needs local services, follow the [development session-start steps](development.md#start-of-each-work-session). Documentation-only edits do not require starting the app or its services.

## Find the right boundary

This section is for those who want to find the right place for a change and
reuse the project's existing tools.

| Location | Responsibility |
| --- | --- |
| `apps/web` | The Nuxt web application. |
| `apps/worker` | The worker scaffold. |
| `packages/contracts` | Shared contracts without provider-specific or framework-specific globals. |
| `packages/server` | Server-only database and integration code. |
| `packages/street-renderer` and `packages/streetmix` | Independent package cores that receive provider clients through explicit interfaces. |
| `infra` | Infrastructure definitions. |
| `dev` and `scripts` | Development and test helpers. |

Read the relevant guide before changing infrastructure or development helpers.
The [workspace dependency guide](workspace-dependencies.md) explains which parts
of the repository may import one another.

For user-interface changes, follow these steps:

1. Inspect existing components, Storybook examples and [design tokens](design-tokens.md) before choosing a pattern.
2. Use the current implementation and component APIs rather than planned wiki descriptions.
3. Use the project's CSS and tokens; do not add Tailwind.
4. Check keyboard access, responsive layouts, loading, empty and error states.

## Write developer documentation

Follow the mandatory [documentation style guide](documentation-style-guide.md)
when writing or reviewing documentation, including instructions for AI agents.
It contains the writing rules and documentation review checklist for human and
AI contributors.

## Validate the change

This section is for those who want to check that a change works and report what
they tested.

1. Use the [development guide](development.md) for setup and the [testing guide](testing.md) to choose checks appropriate to the change.
2. Test meaningful behavior and risks at the lowest useful layer, and run the required code and integration checks.
3. For documentation-only changes, use the [documentation review checklist](documentation-style-guide.md#documentation-review-checklist).
4. Investigate visual differences instead of regenerating baselines merely to pass.
5. Report the checks actually run, their results, and any validation gaps.

## Protect data and operations

This section is for those who want to protect private information and avoid
changes that could damage shared services or data.

- Use synthetic fixtures and disposable test services, never production data.
- Keep secrets, credentials and private data out of code, logs, prompts and commits.
- Keep private and unpublished content out of public responses.
- Validate and authorize operations on the server.
- For migrations and destructive actions, preserve data, document compatibility and recovery, and use isolated test databases.
- Do not deploy, provision resources, publish packages, change permissions or access production systems without explicit authorization.

## End of each work session

This section is for those who want to stop local services and free their ports
when work is finished. If you started no local services, no shutdown commands
are needed.

1. Press Ctrl+C in terminals running apps or log viewers you started.
2. If you started Docker services, run `pnpm dev:stop` from the same checkout. It stops only that checkout's Compose project and releases its ports.
3. If you used Docker services, run `pnpm dev:status` to confirm the checkout's containers stopped.

If Windows asks “Terminate batch job (Y/N)?”, enter `Y` and press Enter.
Stopping the containers preserves database, dependency and emulator-download
volumes, but in-memory emulator accounts and records are lost.
The [development shutdown guide](development.md#end-of-each-work-session)
explains the details.

## Hand off for review

This section is for those who want to prepare changes for someone else to review.

1. Review the complete diff and keep it focused on the requested change.
2. Prepare the review summary using the [review-description standards](documentation-style-guide.md#review-descriptions-and-release-notes).
3. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for the review workflow and report security-sensitive problems privately to a maintainer.
