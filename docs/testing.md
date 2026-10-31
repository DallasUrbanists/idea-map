# Testing and validation

Choose the lowest layer that proves a specific failure mode. The feature's implementer owns its checks and fixtures; reviewers check that the test actually guards that risk. Do not add placeholder feature tests, duplicate the same assertion through every layer, or copy v1's suite wholesale. This policy applies now; the database, Storybook and Playwright tooling below are future work, not commands that already exist.

## Current runnable foundation

From the repository root, use the pinned Node and pnpm versions in `package.json`, then run `pnpm install --frozen-lockfile`. Existing commands:

| Change / risk | Focused command | What it checks |
| --- | --- | --- |
| Boundary parser behavior | `node --test scripts/boundaries.test.mjs` | Existing cases reject browser/server and package/application leaks, including dynamic imports and Vue scripts; server code can use Node builtins. |
| A single boundary risk | `node --test --test-name-pattern="browser imports" scripts/boundaries.test.mjs` | Runs the named browser-import test. Substitute another test name when investigating. |
| Workspace source imports | `pnpm lint` | Scans app and package source for forbidden dependencies; see [workspace dependency decision](workspace-dependencies.md) for limitations. |
| All existing tests | `pnpm test` | Runs the Node test files under `scripts/`; no application journey tests exist yet. |
| Type/build boundary | `pnpm typecheck` or `pnpm build` | Both currently run `tsc --build`; run once for a change when both would do the same work. |

The package directories are bootstrap exports with no package-specific tests or test scripts yet. Use the boundary test above for the current shared workspace risk; do not claim it tests future package functionality. When real package behavior lands, its implementing issue should add focused package-level commands alongside meaningful tests. Tests must not require network access or production credentials by default.

## Ownership by layer

| Layer and owner | Distinct risk to cover | Timing / dependency |
| --- | --- | --- |
| Pure/domain and independent package tests: owner of the domain or package change | Geometry, validation and transformations produce incorrect results for meaningful inputs or edge cases. Prefer fast deterministic tests without UI or providers. | Add alongside actual behavior; package owners for #67 and #69 and later implementations own their commands and fixtures. |
| Database/API integration: schema/API feature owner | Authorization, ownership, transactions, idempotency or private fields leak across the actual database/API boundary. Use an isolated test database, migrations, deterministic fixtures and provider fakes; never use production data. | #13/#15 and feature issues own their integration setup and checks; #21 owns local dependency setup and #22 owns deterministic seeds and provider mocks. |
| Component / Storybook interaction and accessibility: component owner | Keyboard operation, labels, focus, semantic state and interaction behavior fail in a component. Include automated accessibility checks and manual keyboard/screen-reader review for affected flows; automation alone cannot establish accessibility. | #38 owns the component catalog, #39 owns accessibility and visual acceptance, and component implementation issues own their stories and focused checks. #21 owns development setup; #22 supplies deterministic mocks. |
| Small Playwright suite: journey owner | A small set of essential cross-system journeys fails despite lower-layer checks. Use stable fixtures and deterministic providers, not timing sleeps or production accounts. | #11 and #21 provide app/development foundation, #22 supplies fixtures and mocks, and subsequent feature issues own concrete journey checks when the journeys exist. |

Essential journeys to cover as implemented include guest submission and draft preservation; verified ownership and login; private moderation before publication; approved SSR metadata; reconnect recovery; and saved-content/permalink continuity. Each journey should identify its user-visible failure, fixture ownership and the lower-layer checks it complements. Do not require nonexistent tools or tests to pass this bootstrap issue.

## Selecting checks and reviewing baselines

1. During development run the focused test for changed logic and `pnpm lint` when imports or boundaries change. Run typecheck/build when TypeScript or workspace configuration changes. A docs-only change needs a reviewed diff, checked links and accurate commands; no unrelated app install is required.
2. Before review run applicable tests for affected packages and integrations, plus the current workspace `pnpm lint`, `pnpm test` and `pnpm build` when code or shared configuration changes. State exactly what ran, environment and any skipped check in the PR. Changes to shared contracts, configuration or dependencies may affect downstream packages even when their own files did not change.
3. At integration and release checkpoints, run the broader deterministic integration, accessibility and essential-journey suites that exist at that time. Run limited live-provider smoke checks separately in an isolated environment, with authorization and no production data. Record accessibility, privacy and recovery evidence where relevant; investigate failures rather than masking them.
4. Visual snapshots are evidence, not an automatic oracle. Investigate any difference at the relevant viewport and state, compare it with the intended design and check accessibility. A reviewer approves an intentional change before a baseline is updated; include the reason and visual diff in the PR. Never regenerate baselines merely to turn a failing check green.

A test belongs at a higher layer only when it covers a distinct interaction or failure that the lower layer cannot establish. Prefer stable selectors and controlled clocks/providers; avoid flaky timing and broad snapshots that hide the cause of failure. A passing test count is not a substitute for reviewed behavior.
