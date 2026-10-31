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
The idea API currently returns 404 for every ID: publication storage and public
idea data are not implemented, so no drafts can be exposed. The idea page is
scaffolding until a published-only data source is connected.

Nuxt runtime configuration is private by default; only values under `public`
are serialized to browsers. Use the `NUXT_` environment-variable convention
for server runtime overrides and never put credentials under `public`. Future
browser-only maps and speech integrations belong in client-only components or
plugins; they must not be imported by server-rendered modules.

The pnpm workspace separates web and worker applications, shared contracts,
server-only integrations, and independent street-renderer and Streetmix
packages. The source boundary check rejects browser imports of server-only code
and Node built-ins, and package imports of applications. See [the dependency
decision](docs/workspace-dependencies.md) for its scope.
