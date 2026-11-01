# Contributing to Idea Map

This document is for people, including first-time contributors, who want to
improve Idea Map. It shows how to choose a task, prepare a local copy, make and
test a change, and submit it for review.

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

| Topic | More guidance |
| --- | --- |
| Developer setup | [Developer setup and troubleshooting](https://github.com/DallasUrbanists/idea-map/wiki/Developer-Setup-and-Troubleshooting) |
| Components and appearance | [Design system and Storybook](https://github.com/DallasUrbanists/idea-map/wiki/Design-System-and-Storybook) |
| Validation | [Testing and definition of done](https://github.com/DallasUrbanists/idea-map/wiki/Testing-and-Definition-of-Done) |

## Run locally

This section is for those who want to run the app on their own computer while
working on a change.

Commands run from the repository root, the folder containing
`pnpm-workspace.yaml`, and work in PowerShell and Bash.

### One-time setup

This section is for those who want to install the required tools and save the
local settings for a new checkout.

1. Complete the [development setup](docs/development.md#one-time-setup-for-each-checkout) to install tools and dependencies and create the root `.env`.
2. Confirm your `.env` uses the local demo settings from [`.env.example`](.env.example).

Setup uses Node 24.22.1, pnpm 11.25.0 and Docker. The local database and Firebase
emulators need no production credentials.

### Start of each work session

This section is for those who want to start local services and open the app
before making changes.

1. Follow the [development session-start steps](docs/development.md#start-of-each-work-session) to start services, check readiness, apply migrations and run `pnpm dev`.
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
[shutdown guide](docs/development.md#end-of-each-work-session) explains what data
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
checks in the [testing guide](docs/testing.md), and authentication work also needs
the [manual and automated auth checks](docs/auth-manual-testing.md).

For documentation-only changes, review wording, links and commands; an unrelated
application build is unnecessary.

## Open a pull request

This section is for those who want to share a completed change and give
reviewers the information they need.

1. Review the complete diff and finish the applicable checks above.
2. Push your branch to your repository.
3. Open a pull request against `main`.

| Include in the description | Why it helps |
| --- | --- |
| What changed and why, with an issue link | Gives reviewers the problem and intended result. |
| Checks run and any checks you could not run | Shows what was verified and what remains uncertain. |
| Screenshots when appearance changed | Makes visual changes easier to assess. |

A draft pull request is welcome while work is in progress. Ask for help when
you are stuck.

## Using AI tools

This section is for those who want to use AI assistance while remaining
responsible for the changes they contribute.

1. Review AI-generated changes and make sure you understand them before submitting.
2. Keep credentials and private data out of prompts.
3. Read the [AI tool onboarding guide](docs/ai-onboarding.md) for setup and the [AI-assisted development guide](https://github.com/DallasUrbanists/idea-map/wiki/AI-Assisted-Development) for instructions and troubleshooting.

AI tools are optional. Report security-sensitive problems privately to a
maintainer; contributions follow the repository's [Apache-2.0 license](LICENSE).
