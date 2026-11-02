# Release procedure

If you're preparing a change for release, these steps help you record what
changed, check compatibility, and prepare a version update. Contributors and
maintainers have separate steps, followed by guidance on reviewing package
artifacts and recovering from a release that goes wrong.

Workspace packages are `private: true`. Changesets versions private packages
when explicitly included but does not tag them. The `access: restricted` setting
is a conservative default, not permission to publish. Publication and production
deployment require explicit authorization.

The following contents links navigate within this guide:

- [Prepare a contribution](#prepare-a-contribution)
- [Version a release](#version-a-release)
- [Review package artifacts](#review-package-artifacts)
- [Compatibility, rollback, and recovery](#compatibility-rollback-and-recovery)
- [Validate release tooling without publication](#validate-release-tooling-without-publication)

## Prepare a contribution

You should prepare release information with these steps:

1. For delivered behavior or a public package API change, run `pnpm changeset`
    and select each affected application or package and its version bump.
2. Review package compatibility and tests with the changeset, using patch for
    compatible fixes, minor for compatible additions, and major for breaking
    changes. Coordinate versions and consumers during `0.x` releases rather than
    assuming stable major-version guarantees.
3. Follow the
    [changeset and release-note writing standards](../contributor-guides/documentation-style-guide.md#review-descriptions-and-release-notes).

If a renderer change affects the app, one changeset can name both
`@idea-map/web` and `@idea-map/street-renderer`. Internal-only changes and
documentation without delivered behavior need no changeset.

## Version a release

Changesets independently versions applications and packages in the pnpm
workspace. A version update alone does not publish or deploy them.

Authorized maintainers should follow this sequence:

1. Run the pinned installation, lint, tests, typecheck, and build, plus relevant
    package and integration checks from the
    [testing guide](../contributor-guides/testing-guide.md).
2. Fetch `origin/main`, run `pnpm release:status`, and inspect missing
    changesets for changed packages instead of adding notes for undelivered
    work.
3. Create a dedicated version pull request with `pnpm changeset version` and
    review generated versions, changelogs, and workspace dependencies against
    the writing standards.

The `pnpm release:status` command summarizes pending changesets and compares
package changes with `origin/main`; missing changesets can make the check fail.
The `pnpm changeset version` command consumes changeset files and must not run
automatically on every pull request. Versioning, merging, publishing, and
deployment remain separate authorized operations.

Maintainers should prepare application release notes around an immutable
reviewed commit or image, following the writing standards. Versioning an app
does not deploy it.

## Review package artifacts

The
[Node.js and TypeScript guide](../architecture/nodejs-typescript.md#package-exports)
defines build and export conventions. Maintainers should validate built
artifacts, declaration resolution, and the dependency graph in a clean checkout.

Before publication, maintainers should review the package's `private` setting,
name, license, asset provenance, README, exports, generated types, runtime
dependencies, and package archive produced by `pnpm pack` in a disposable
directory. Confirm registry scope, access policy, trusted publishing identity,
and permission through an approved release plan.

Maintainers should remove a `private` guard or publish only with explicit
authorization. Keep credentials out of changesets, packages, logs, and pull
requests.

## Compatibility, rollback, and recovery

Operators should record the previous app image or commit, package versions,
configuration, and database compatibility before deployment or migration. Prefer
expand/contract database changes so old and new application versions can
coexist; verify rollback in a clean environment and record a recovery owner and
backup.

For a faulty published package, maintainers should publish a reviewed corrective
version under separate authorization and restore consumers to a compatible
previous version. Maintainers should not assume that registry versions can be
overwritten or silently rewrite release history.

Operators should follow the authorized deployment procedure for application
rollback and verify schema and data compatibility before restoring anything.

## Validate release tooling without publication

Maintainers can check Changesets in a disposable synthetic workspace by adding
an application and package changeset, running `changeset status` and
`changeset version`, and inspecting both outputs. Synthetic changes must not
enter the real release queue. Maintainers should verify registry and provider
terms for the actual release.
