# Contributing to Idea Map

Welcome! You can help by fixing a bug, improving the docs, or building a feature.
If this is your first contribution, a small documentation fix is a good place to start.

## Find something to work on

Browse the [open issues](https://github.com/DallasUrbanists/idea-map/issues).
Before starting, check whether someone is already working on the issue and whether
it depends on other work. Leave a comment if you'd like to help or need clarification.

For project priorities, see the [roadmap](https://github.com/DallasUrbanists/idea-map/wiki/Roadmap-and-Milestones).

## Make your change

1. Fork and clone the repository, or clone it directly if you have access.
2. Create a branch from the latest `main`.
3. Follow the setup steps below to install dependencies and run the app.
4. Keep your change focused on one issue. For UI work, look for an existing
   component or Storybook example before creating something new.

The wiki has more guidance when you need it:

- [Developer setup and troubleshooting](https://github.com/DallasUrbanists/idea-map/wiki/Developer-Setup-and-Troubleshooting)
- [Design system and Storybook](https://github.com/DallasUrbanists/idea-map/wiki/Design-System-and-Storybook)
- [Testing and definition of done](https://github.com/DallasUrbanists/idea-map/wiki/Testing-and-Definition-of-Done)

## Run locally

Install Node 24.22.1 and pnpm 11.25.0. From the repository folder, run:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --build
pnpm --filter @idea-map/web dev
```

Open http://localhost:3000.

The app is still under development. To start the local database, Firebase
emulators, and Storybook, follow the [development guide](docs/development.md).
It also covers Docker setup and troubleshooting. Normal development does not
require production credentials.

## Check your changes

For code changes, run:

```sh
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm test:web
```

These check imports, run the root tests, check types, build the app, and test the
built web server. Some packages have additional tests.
See the [testing guide](docs/testing.md) to choose the checks for your change.

## Open a pull request

Push your branch and open a pull request against `main`. Include:

- What you changed and why, with a link to the issue.
- How you checked it, including any checks you couldn't run.
- Screenshots if the appearance changed.

A draft pull request is welcome if you'd like feedback while you're working.
Ask for help when you're stuck, and respond to review comments as you go.

## Using AI tools

AI tools are optional. Review the code they produce and make sure you understand
the change before submitting it. Keep credentials and private data out of prompts.
See the [AI tool onboarding guide](docs/ai-onboarding.md) and [AI-assisted development](https://github.com/DallasUrbanists/idea-map/wiki/AI-Assisted-Development)
for more guidance.

Please report security-sensitive problems privately to a maintainer.
Contributions follow the repository's [Apache-2.0 license](LICENSE).
