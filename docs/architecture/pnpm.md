# pnpm architecture

When you add a dependency or run a project command, pnpm connects the packages
across Idea Map's workspace. This guide explains how dependencies, the lockfile,
and shared scripts work together so your changes stay consistent across
checkouts.

The following contents links navigate within this guide:

- [Dependencies and installation](#dependencies-and-installation)
- [Script ownership](#script-ownership)
- [License review](#license-review)

## Dependencies and installation

The root manifest pins pnpm 11.25.0, and the
[workspace configuration](../../pnpm-workspace.yaml) includes `apps/*` and
`packages/*`.

pnpm links workspace packages and records resolved dependencies in the committed
[lockfile](../../pnpm-lock.yaml). You should use the pinned package manager and
frozen-lockfile installation so checks use the locked dependency versions. You
should review dependencies when the lockfile changes.

The workspace explicitly permits esbuild's installation script because the
Vite/Nuxt build requires its platform binary. Build permissions for other
dependencies remain explicit in `allowBuilds`; you should review changes instead of enabling all installation scripts.

## Script ownership

Root package scripts provide stable development, test, and release entry points.
You can select a package's focused commands with `--filter`. The helpers handle
each checkout's project name, load configuration, and manage service details, so
you don't need personal shell commands for those steps.

The [development guide](../contributor-guides/development-guide.md) defines
session commands and configuration. The
[testing guide](../contributor-guides/testing-guide.md) defines required checks,
and the [release procedure](../policies/release-procedure.md) defines Changesets
usage and authorization.

## License review

The workspace software is Apache-2.0, while dependencies retain their own
licenses. Maintainers should generate metadata with
`pnpm licenses list --prod --json`, inspect the actual shipped files, and
preserve required license and NOTICE texts. Package metadata alone does not show
that you have the rights to distribute all the files that ship.
