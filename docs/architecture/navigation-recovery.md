# Navigation recovery model

Contributors can use the provider-free navigation model to reason about browse
context when connecting the map workspace to navigation. The model accepts
synthetic data and has no dependency on a router, map provider, browser storage,
or draft storage.

The following contents links navigate within this guide:

- [State and validation](#state-and-validation)
- [Transitions and integration](#transitions-and-integration)
- [Offline checks](#offline-checks)

## State and validation

The model in [`navigation-recovery.ts`](../../apps/web/app/utils/navigation-recovery.ts)
contains a view (`browse`, `detail`, or `submit`), an optional browse context,
and a submit step (`locate` or null). Browse context contains latitude and
longitude in degrees, a nonnegative zoom, and a nonnegative list scroll offset.
All values must be finite numbers; latitude ranges from -90 to 90 and longitude
from -180 to 180, inclusive. The model does not choose provider-specific zoom
limits or a default map location.

`restoreNavigation` accepts an unknown history-like snapshot and returns a new
state. Missing or invalid browse context becomes null, an unrecognized view or
a Submit view with an invalid step falls back to Browse, and unknown fields are
discarded. Steps on other views are reset to null.
Consumers should handle a null browse context without assuming a previous
viewport exists. The model stores no idea identifier, text, identity, credentials,
or private draft content.

## Transitions and integration

`captureBrowse` accepts a complete context while the view is Browse. It ignores
invalid captures and returns a copy of the previous state. `openDetail` changes
Browse to Detail, and `returnToBrowse` returns from either Detail or Submit while
preserving the captured context. `enterSubmitFromBrowse` sets the submit step to
Locate; calling it outside Browse leaves the state unchanged. Each operation
returns fresh state without mutating its input, including the nested viewport.

Consumers should keep snapshots for history entries and pass each snapshot to
`restoreNavigation` when restoring an entry. The model does not manage history,
select a detail record, persist state, render a map, or advance submission steps.
Consumers should manage recoverable drafts separately: opening or closing the
modeled Submit view has no draft input or storage side effect. Integration must
still verify actual navigation, persistent map behavior, draft recovery, and
accessibility in the application.

## Offline checks

After completing the [checkout setup](../contributor-guides/development-guide.md#one-time-setup-for-each-checkout),
contributors can run the focused synthetic tests from the repository root:

```sh
node --test scripts/navigation-recovery.test.mjs
```

The tests require no providers, services, or user data. The
[testing guide](../contributor-guides/testing-guide.md) describes aggregate checks.
