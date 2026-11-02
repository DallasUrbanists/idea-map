# Contributing to Idea Map

You can help improve Idea Map with code, documentation, or feedback. This guide
takes you from choosing a task and setting up a checkout to checking your change
and sharing it for review.

## Find something to work on

This section is for those who want to choose a useful task and understand
whether someone else is already working on it.

1. Browse the [open issues](https://github.com/DallasUrbanists/idea-map/issues).
2. Check whether the issue already has someone working on it and whether it depends on other work.
3. Leave a comment if you would like to help or need clarification.

The [roadmap](https://github.com/DallasUrbanists/idea-map/wiki/Roadmap-and-Milestones)
explains project priorities. A small documentation fix can be a good first
contribution.

## Make your change

This section is for those who want to prepare a working copy and keep their
change focused on one task.

1. Fork and clone the repository, or clone it directly if you have access.
2. Create a working branch from the latest `main`.
3. Follow the [local workflow below](#run-locally) to prepare your checkout and start a work session.
4. Keep the change focused on one issue.
5. For user-interface work, look for an existing component or Storybook example before creating your own.

When writing or updating documentation, follow the
[documentation style guide](docs/contributor-guides/documentation-style-guide.md).

The [documentation index](docs/README.md) covers project guidance.
The following guides cover common development tasks:

| Topic | More guidance |
| --- | --- |
| Developer setup | [Developer setup and troubleshooting](docs/contributor-guides/development-guide.md) |
| Components and appearance | [Design system and Storybook](docs/design/design-system.md) |
| Validation | [Testing and definition of done](docs/contributor-guides/testing-guide.md) |

## Run locally

This section is for those who want to run the app on their own computer while
working on a change.

Commands run from the repository root, the folder containing
`pnpm-workspace.yaml`, and work in PowerShell and Bash.

### One-time setup

This section is for those who want to install the required tools and save the
local settings for a new checkout.

1. Complete the [development setup](docs/contributor-guides/development-guide.md#one-time-setup-for-each-checkout) to install tools and dependencies and create the root `.env`.
2. Confirm your `.env` uses the local demo settings from [`.env.example`](.env.example).

Setup uses Node 24.22.1, pnpm 11.25.0 and Docker. The local database and Firebase
emulators need no production credentials.

### Start of each work session

This section is for those who want to start local services and open the app
before making changes.

1. Follow the [development session-start steps](docs/contributor-guides/development-guide.md#start-of-each-work-session) to start services, check readiness, apply migrations and run `pnpm dev`.
2. Open <http://127.0.0.1:3000>.

The development guide also explains optional Storybook startup and running the
app in Docker.

### End of each work session

This section is for those who want to stop local services and free their ports
when they finish working.

1. Press Ctrl+C in terminals running Nuxt, Storybook or log viewers.
2. Run `pnpm dev:stop` from the repository root to stop this checkout's background services.
3. Run `pnpm dev:status` to confirm they stopped.

Closing a log viewer does not stop background services. The
[shutdown guide](docs/contributor-guides/development-guide.md#end-of-each-work-session) explains what data
persists and how to handle Windows shutdown prompts.

## Check your changes

This section is for those who want to verify their work before asking someone
else to review it.

Run these commands in order from the repository root after completing setup:

1. Run `pnpm lint` to check application and package import rules.
2. Run `pnpm test` for the root tests.
3. Run `pnpm typecheck` to check workspace and Nuxt types.
4. Run `pnpm build` to build workspace packages and the production web app.
5. Run `pnpm test:web` to test the built web server.

Expect each command to finish without failures. Some packages have additional
checks in the [testing guide](docs/contributor-guides/testing-guide.md), and authentication work also needs
the [manual and automated auth checks](docs/contributor-guides/testing-guide.md#authentication-testing).

For documentation-only changes, follow the
[documentation review checklist](docs/contributor-guides/documentation-style-guide.md#documentation-review-checklist).

## Open a pull request

This section is for those who want to share a completed change and give
reviewers the information they need.

1. Review the complete diff and finish the applicable checks above.
2. Push your branch to your repository.
3. Open a pull request against `main`.

Prepare the description using the
[review-description standards](docs/contributor-guides/documentation-style-guide.md#review-descriptions-and-release-notes).

A draft pull request is welcome while work is in progress. Ask for help when
you are stuck.

When reviewing a pull request, you should follow the
[pull-request review guide](docs/contributor-guides/pull-request-review-guide.md)
for behavior, documentation, validation, and feedback checks.

## Using AI tools

You should use AI assistance with these safeguards:

1. Review AI-generated changes and make sure you understand them before submitting.
2. Keep credentials and private data out of prompts.
3. Read the [AI contributor guide](docs/contributor-guides/ai-agent-guide.md)
    for tool setup and review tips. Shared agent rules are in [AGENTS.md](AGENTS.md).

AI tools are optional. Report security-sensitive problems privately to a
maintainer; contributions follow the repository's [Apache-2.0 license](LICENSE).
