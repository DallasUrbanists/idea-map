# Local development

Install Node 24.22.1, pnpm 11.25.0 and Docker Desktop with its Linux engine (or
a compatible Linux Docker Engine with Compose). From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:services
pnpm dev:status
pnpm dev:check
pnpm exec tsc --build
pnpm --filter @idea-map/web dev
```

In a second terminal run `pnpm --filter @idea-map/web storybook --no-open`.
Nuxt is at http://localhost:3000 and Storybook at http://localhost:6006. The
welcome story is only a connectivity specimen; the component catalog is later
work. The supporting services bind loopback only: PostgreSQL/PostGIS on 54329,
Firebase Auth emulator on 9099 and Firestore emulator on 8080. They use the
`demo-idea-map` project and deny-by-default Firestore rules. No cloud credentials
are needed. `pnpm dev:check` queries PostGIS and the emulator HTTP endpoints; it
does not assert application integration, database schema or emulator rules. The
emulators may take time to download and start on the first run; retry the check
after reviewing logs if they are not ready.

The database is empty until migrated. To use the published-idea read locally,
set `DATABASE_URL` and `NUXT_DATABASE_URL` in your shell to
`postgres://idea_map:local-only@127.0.0.1:54329/idea_map_dev`, then run
`pnpm --filter @idea-map/server db:migrate` before starting Nuxt. These values
are local-only. A fresh database contains no ideas. Synthetic seed data, provider
mocks, and complete browse/submit/auth/jobs flows are tracked by #22; the
emulators are not wired to application authentication or projections yet.

Stop only this checkout's Compose project with `pnpm dev:stop`; its database and
dependency volumes remain for the next start. Project names derive from the
checkout path so another checkout's project is not stopped. The published ports
are fixed, so two checkouts cannot run these services simultaneously without a
port conflict. The commands do not terminate native Nuxt or Storybook terminals.

## Docker-only fallback

With Docker and Node/pnpm available for the command wrapper, run `pnpm dev:all`.
It starts services plus Nuxt and Storybook in a tools container, installing the
locked dependencies there. Alternatively, without host Node/pnpm, invoke Docker
Compose with a unique `--project-name` and `--profile tools up -d --build`; use
the same project name with `--profile tools ps` and `--profile tools down` to
inspect and stop it. The wrapper computes its project name from the checkout path
and prints it; use that name with `docker compose -p NAME logs -f tools`. The
fallback starts with an empty database too; run the following from the repository
root after the tools container starts, replacing `NAME` with that project name:

```sh
docker compose -p NAME --profile tools exec -e DATABASE_URL=postgres://idea_map:local-only@db:5432/idea_map_dev tools pnpm --filter @idea-map/server db:migrate
```

The wrapper never deletes volumes. Container `node_modules`, build outputs,
Nuxt output/cache, Storybook output, Vite caches and pnpm store use named volumes
rather than the host's directories.
Polling is enabled in the container for mounted-file changes; it uses more CPU and
may be slower on Windows/macOS than native editing. WSL users should prefer a
Linux filesystem for the checkout when possible.

If startup fails, check Docker's Linux engine and `pnpm dev:status`, then inspect
the relevant Compose logs. Stop a service already using a required port only if
you own it, or configure a separate local port mapping. The Firebase CLI downloads
emulator artifacts on first startup; a network connection is needed then. No
production credentials, production data, or hosted resources are used by this setup.
