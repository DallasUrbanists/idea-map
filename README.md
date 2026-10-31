# Idea Map

A place to share and explore ideas for improving our communities.

Want to help? Start with the [contributing guide](CONTRIBUTING.md).
The [wiki](https://github.com/DallasUrbanists/idea-map/wiki) explains the project
and its plans.

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

## Learn more

- [Architecture and technology decisions](https://github.com/DallasUrbanists/idea-map/wiki/Architecture-and-Technology-Decisions)
- [Design system and Storybook](https://github.com/DallasUrbanists/idea-map/wiki/Design-System-and-Storybook)
- [Workspace dependencies](docs/workspace-dependencies.md)
- [Releases](docs/releases.md)
- [Infrastructure setup](docs/terraform-foundation.md)
