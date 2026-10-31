# Working on Idea Map with an agent

AI assistance is optional. The contributor remains responsible for the change,
its review and validation. Start with the issue, its dependencies and the current
repository state. Ask when a consequential requirement is unclear; do not invent
product behavior or treat planned features as implemented. Preserve existing user
work and inspect unexpected changes before editing; never reset or overwrite them.

## Find the right boundary

- `apps/web` is the Nuxt application; `apps/worker` is the worker scaffold.
- `packages/contracts` holds shared contracts without provider or framework
  globals. `packages/server` holds server-only database and integration code.
- `packages/street-renderer` and `packages/streetmix` are independent package
  cores. Inject provider clients through explicit interfaces. See
  [workspace dependencies](workspace-dependencies.md) for enforced import rules.
- Infrastructure definitions live in `infra`; development and test helpers live
  in `dev` and `scripts`. Consult the relevant guide before changing them.

For UI work, inspect existing components, stories and
[design tokens](design-tokens.md) first; reuse an appropriate component rather
than inventing its API. Check the current implementation and examples, not just
planned wiki descriptions. Use the project's CSS and tokens; do not add Tailwind.
Consider keyboard access, responsive layouts and loading, empty and error states.

## Validate the change

Use the [development guide](development.md) for local setup and
[testing guide](testing.md) to select checks. Test meaningful behavior and risks
at the lowest useful layer; avoid redundant tests that only mirror implementation.
Run the documented code checks and relevant package or integration checks for
the change. Documentation changes need a wording, link and command review, not
an unrelated application build. Investigate visual differences instead of
regenerating baselines merely to pass. Report checks actually run and any gaps.

## Protect data and operations

Use synthetic fixtures and disposable test services, never production data.
Do not put secrets, credentials or private data in code, logs, prompts or commits.
Keep private and unpublished content out of public responses; validate and
authorize server-side operations. Treat schema migrations and destructive actions
with care: preserve data, document compatibility and recovery, and use isolated
test databases. Do not deploy, provision resources, publish packages, change
permissions or access production systems without explicit authorization.

## Hand off for review

Keep the diff focused. Review the complete diff, explain behavior and rationale,
link the issue, and record validation and limitations in the PR. Include visual
evidence when useful. Do not claim an unrun check passed or describe a proposal
as an operational feature. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for the
review workflow and report security-sensitive issues privately to a maintainer.
