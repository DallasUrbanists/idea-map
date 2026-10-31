# Testing your changes

Start with a test that checks the behavior you changed. For example, a renderer
change needs a renderer test; a wording change needs a careful read and a link check.

The [testing wiki](https://github.com/DallasUrbanists/idea-map/wiki/Testing-and-Definition-of-Done)
explains the wider testing approach and what we expect before work is complete.

## Everyday checks

Use the Node and pnpm versions in the [README](../README.md), then run
`pnpm install --frozen-lockfile` from the repository folder.

| Command | What it does |
| --- | --- |
| `pnpm lint` | Checks that application and package imports follow the workspace rules. |
| `pnpm test` | Runs the root tests in `scripts/`. |
| `pnpm typecheck` | Builds workspace TypeScript and checks Nuxt types. |
| `pnpm build` | Builds workspace TypeScript and the production Nuxt app. |
| `pnpm test:web` | Starts and checks the built web server. Run `pnpm build` first. |

Run these before requesting review for code or shared configuration changes.
The root test command doesn't include every package test.

For documentation changes, check the wording, links, and commands.
You don't need to build the app just to fix a typo.

## Package tests

Run the test for the package you changed.

For the street renderer:

```sh
pnpm exec tsc --build
pnpm --filter @idea-map/street-renderer test
```

For Streetmix:

```sh
pnpm --filter @idea-map/streetmix test
```

The Streetmix test builds the package and uses a fake provider, so it doesn't
need a live Streetmix service.

For import-rule changes, run `node --test scripts/boundaries.test.mjs`.
The [workspace guide](workspace-dependencies.md) explains those rules.

## Database tests

Use an **empty, disposable PostGIS database** whose name starts with
`idea_map_test_`. These tests create records and run migrations. Never use a
shared or production database.

To test the database schema, set `TEST_DATABASE_URL` to that database's connection
string and run:

```sh
pnpm exec tsc --build
pnpm --filter @idea-map/server test:database
```

To check that server-rendered pages show only approved ideas:

1. Create a separate empty test database.
2. Set `DATABASE_URL` to its connection string and run
   `pnpm --filter @idea-map/server db:migrate`.
3. Load `packages/server/test/ssr-fixture.sql` into it using your PostgreSQL client.
   This fixture contains synthetic ideas for the test.
4. Set `TEST_DATABASE_URL` to the same connection string.
5. Run `pnpm build`, then `pnpm test:web:published`.

See the [development guide](development.md) for local PostGIS setup.
This published-page check verifies that both an idea and its displayed revision
are approved before the page shows the title and description.

## UI changes

Look for an existing Storybook example before adding a new one. Check the states
your change affects, such as loading, empty results, or errors. Try the keyboard
and a small screen as well.

Include screenshots when they help a reviewer understand the result. If a visual
test changes, investigate the difference and get the intended design reviewed
before updating its baseline.

See [Design system and Storybook](https://github.com/DallasUrbanists/idea-map/wiki/Design-System-and-Storybook)
for component and accessibility guidance. The current welcome story checks setup;
a full component catalog and complete user journeys are still being built.

## In your pull request

List the checks you ran and their results. If you skipped a check, say why.
Include any setup details a reviewer needs to reproduce the result.
