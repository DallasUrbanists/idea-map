# Contributing to Idea Map

Thanks for helping improve the map. The repository is Apache-2.0; see
[LICENSE](LICENSE). Report security-sensitive information privately to a
maintainer instead of placing credentials or personal data in an issue or PR.

## Choose and scope work

1. Read the relevant [open issues](https://github.com/DallasUrbanists/idea-map/issues)
   and linked project decisions. Check the issue's dependencies, assignees,
   comments and open PRs before starting; coordinate with an existing owner
   rather than duplicating their work. Ask on the issue when requirements or
   ownership are unclear.
2. Choose a small, reviewable change. Confirm prerequisite code is available on
   the base branch; an unmerged PR does not establish that dependency. Preserve
   existing work and discuss any change in scope with maintainers.
3. Create a short-lived branch from the current default branch. Make focused
   commits, then open a PR against the default branch and link its issue. For
   example, `Closes #123` in a PR body links completion to a merge; don't close
   an issue merely because implementation has started.

## Set up and run

Use Node 24.22.1 and pnpm 11.25.0, then follow the
[development setup](docs/development.md) for native Nuxt/Storybook, isolated
PostGIS and Firebase emulators, ports, migration and the Docker-only fallback.
Start with `pnpm install --frozen-lockfile`. Normal development does not require
production credentials. The current application is a foundation; seeded
end-to-end flows and a full component catalog are separate work.

The setup in [#120](https://github.com/DallasUrbanists/idea-map/pull/120) was
exercised on Windows with Docker Desktop. Linux, macOS, WSL and a fresh
uninvolved-contributor onboarding exercise have not been independently verified
in that evidence; report your environment and any platform-specific results.

## Reuse and validate

Search the existing application, packages, [design tokens](docs/design-tokens.md)
and Storybook before creating a component. Run
`pnpm --filter @idea-map/web storybook --no-open` after setup. The current
welcome story is a setup specimen, not a finished component catalog. For new UI,
use existing responsibilities where suitable and include a focused story or
evidence for relevant states, keyboard access, labels, contrast, small screens
and reduced motion. Visual snapshots are review evidence, not approval by themselves.

Choose checks for the behavior changed; see [testing and validation](docs/testing.md)
for ownership, current commands and integration prerequisites. Typical checks:

```sh
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm test:web
```

`pnpm test` covers root Node tests, not every package or cross-system journey.
For a package change run its focused test too: build TypeScript first with
`pnpm exec tsc --build`, then use `pnpm --filter @idea-map/street-renderer test`
or `pnpm --filter @idea-map/streetmix test` as applicable. Database and published
SSR checks require an **empty disposable** PostGIS database and synthetic data;
follow [testing](docs/testing.md) and [the README](README.md) before running them.
Never run fixture migrations or destructive tests against shared or production data.

Add tests when they prevent a meaningful failure; avoid tests that only repeat
implementation details. For documentation-only work, review the text, commands,
links and diff instead of installing unrelated tools. Report skipped checks and
their reasons rather than presenting them as passed.

## Review and AI-assisted work

Describe the problem, resulting behavior, linked issue, exact checks and their
results in the PR. Include relevant accessibility, privacy, recovery and visual
evidence; distinguish mocked/local checks from live-service verification. Review
the complete diff, dependency and license effects, and any data or schema change.
Keep secrets, personal information and production data out of examples, logs,
fixtures and screenshots. Consult [release guidance](docs/releases.md) for
changesets, compatibility and rollback when a release is affected.

AI assistance is optional. Provide only the context the tool needs, inspect any
repository instructions that apply, and avoid sharing secrets or private data.
The human contributor remains responsible for understanding and reviewing the
change, tests, licenses and safety boundaries; an AI-generated explanation or
passing test does not replace human review. Preserve unrelated local changes and
do not deploy, publish packages, change permissions or merge on behalf of a
maintainer without explicit authorization. Respond to review feedback with new
evidence and leave final acceptance to the maintainer.
