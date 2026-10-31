# idea-map

This repository is an early workspace bootstrap. Install Node 24.22.1 and
pnpm 11.25.0, then run `pnpm install --frozen-lockfile`,
`pnpm lint`, `pnpm test`, and `pnpm build`. The web and worker
applications are placeholders until their implementation issues are complete.

The pnpm workspace separates web and worker applications, shared contracts,
server-only integrations, and independent street-renderer and Streetmix
packages. The source boundary check rejects browser imports of server-only code
and Node built-ins, and package imports of applications. Run it with `pnpm lint`;
see [the dependency decision](docs/workspace-dependencies.md) for its scope.

For focused checks, test ownership and review expectations, see [testing and validation](docs/testing.md).

For versioning, release review and rollback conventions, see [the release guide](docs/releases.md).
