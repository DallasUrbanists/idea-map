# idea-map

Install Node 24.22.1 and pnpm 11.25.0, then run:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm test:web
```

Run the Nuxt application with `pnpm --filter @idea-map/web dev`. The web
server exposes `/api/health` and a public idea route at `/suggestion/:id`.
The idea API reads only approved revisions of approved ideas when the private
`NUXT_DATABASE_URL` is configured. Invalid or unpublished IDs return 404; an
unconfigured or unavailable database returns 503. Use a dedicated read-only role
and an isolated synthetic database for local checks.

Nuxt runtime configuration is private by default; only values under `public`
are serialized to browsers. Use the `NUXT_` environment-variable convention
for server runtime overrides and never put credentials under `public`. Future
browser-only maps and speech integrations belong in client-only components or
plugins; they must not be imported by server-rendered modules.

The pnpm workspace separates web and worker applications, shared contracts,
server-only integrations, and independent street-renderer and Streetmix
packages. The source boundary check rejects browser imports of server-only code
and Node built-ins, and package imports of applications. Run it with `pnpm lint`;
see [the dependency decision](docs/workspace-dependencies.md) for its scope.

For focused checks, test ownership and review expectations, see [testing and validation](docs/testing.md).

For the published SSR integration check, create an empty disposable PostGIS database
whose name begins `idea_map_test_`, run the server migrations against it, load
`packages/server/test/ssr-fixture.sql`, set `TEST_DATABASE_URL` to its connection
string, and run `pnpm test:web:published` after building. The fixture contains only
synthetic data; do not load it into a shared or production database. The runtime
read selects title and description only after both the idea and its referenced
revision are approved. Publishing transitions and richer projections remain later
work. The application role should be read-only and scoped to those required tables.

For versioning, release review and rollback conventions, see [the release guide](docs/releases.md).

For proposed infrastructure definitions, state handling and validation, see [Terraform foundation](docs/terraform-foundation.md).
