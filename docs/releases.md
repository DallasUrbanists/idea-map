# Versioning and release workflow

This repository is a single pnpm workspace. Changesets records intended changes
and independently versions packages and applications; it does not publish or deploy
anything by itself. All current workspace packages are `private: true`. The
configuration versions private packages when explicitly included but does not tag
them. `access: restricted` is a conservative default, not authorization to publish.
No automatic publication or production release is configured in this change.

## Contribution and review

1. For a shipped behavior or public package API change, run `pnpm changeset` and
   select each affected workspace package or application and its bump. An app and
   its package can appear in one changeset and one PR. The changeset text should
   describe the behavior users will receive, not planned work or internal task IDs.
   Internal-only work and documentation without shipped behavior need no changeset.
2. Review package compatibility and tests alongside the changeset. Use patch for
   compatible fixes, minor for compatible additions and major for breaking changes;
   while versions are `0.x`, document any breaking change explicitly and coordinate
   the version and consumers rather than assuming stable major-version guarantees.
   Record migration instructions and required app/package version combinations.
3. Before a release, run the pinned install, lint, tests, typecheck and build, plus
   relevant package/integration checks. Fetch `origin/main` first; `pnpm
   release:status` summarizes all pending changesets and compares package changes
   to that ref. A missing changeset for a changed package can make status fail;
   inspect the change rather than adding a note for unshipped work. This is
   inspection, not a release.
4. In a dedicated, reviewable version PR, an authorized maintainer runs
   `pnpm changeset version`, reviews the generated version/changelog and workspace
   dependency changes, and ensures the changelog describes what actually shipped.
   The command consumes changeset files. It must not run automatically on every PR.
   Merge and publish are separate decisions outside this issue's scope.

For example, a single changeset can name `@idea-map/web` and
`@idea-map/street-renderer` and describe a concrete app-visible renderer change.
Do not add a speculative changeset until that change exists. Applications are
released from an immutable reviewed commit/image; include that commit, affected
package versions, behavior, migration notes and validation in application release
notes. Versioning an app does not deploy it.

## Package build and export conventions

Package cores own their documented public API and tests, remain independent of
application imports and framework globals, and export built ESM from `dist` with
matching declaration files through the package `exports` map. Root TypeScript
build emits package outputs; validate the artifact and dependency graph in a clean
checkout. Do not import private source paths from applications. The renderer and
Streetmix package-specific APIs are owned by [#67](https://github.com/DallasUrbanists/idea-map/issues/67)
and [#69](https://github.com/DallasUrbanists/idea-map/issues/69), respectively;
this workflow does not define or preempt them.

Before any future package publication, maintainers must independently review the
package's `private` setting, name, license, asset/provenance obligations, README,
exports, generated types, runtime dependencies and package tarball (`pnpm pack`
into a disposable directory). Confirm registry scope, access policy, trusted
publishing identity and permission in a separately approved release plan. Only a
separate explicit authorization may remove a `private` guard or publish a package;
this repository provides no automatic publish workflow. Never place credentials
in a changeset, package, log or PR.

## Compatibility, rollback and recovery

Deployments and migrations are separate reviewed operations. Record the prior app
image/commit, package versions, configuration and database schema compatibility.
Prefer expand/contract database changes so old and new app versions can coexist;
verify a rollback against a clean environment and document a recovery owner and
backup. If a published package is faulty, do not assume an immutable registry
version can be overwritten: publish a reviewed corrective version under separate
authorization and roll back app consumers to a compatible previous version. Do not
silently rewrite public release history. Application rollback follows the separately
approved deployment procedure, and never restores incompatible schema or data blindly.

The Changesets CLI can be validated without publishing by creating a synthetic
workspace in a disposable directory, adding a synthetic changeset for an app and a
package, running `changeset status` and `changeset version`, then inspecting both
version/changelog outputs. Synthetic changes must not be added to the real release
queue. The eventual release process must verify registry and provider terms anew.
