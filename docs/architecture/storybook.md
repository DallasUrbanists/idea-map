# Storybook architecture

Storybook is a tool for developing and exploring interface components in
isolation from the full application. You can use it to explore existing
components before building a new one. This guide explains how Idea Map's catalog
is organized, how stories show different component states, and how they support
design and testing. Storybook uses `@storybook/vue3-vite`; its
[configuration](../../apps/web/.storybook/main.js) loads component stories and
foundation documentation from `apps/web/stories/`.

The following contents links navigate within this guide:

- [Catalog and styles](#catalog-and-styles)
- [Validation boundary](#validation-boundary)

## Catalog and styles

The [preview configuration](../../apps/web/.storybook/preview.js) imports the
project token stylesheet and loads the documented typefaces. The theme toolbar
switches component previews and documentation between system, light, and dark
themes. Stories cover the
actual project-owned components, variants, composition patterns, and loading,
empty, error, and disabled states.
Reka primitives do not automatically populate the catalog.

The catalog has two top-level groups: **Foundations** for documentation and
**Components** for individual controls and composed examples. Document props,
events, slots, and meaningful examples before creating another overlapping
component.

**Foundations / Tokens** groups the shared stylesheet's custom properties into
colors, motion, and globals. Color and motion values resolve theme and
reduced-motion overrides; global values retain their shared declarations. The
motion section also describes transition timing and reduced-motion guidance. The
catalog, **Foundations / Color**, and **Foundations / Size and space** read the
stylesheet through a shared JavaScript reader, so values and assignments come
from the preview's source. Size and space includes spacing samples; Containers
documents the shared container classes and their radius and shadow values.

The selected production catalog address is
[storybook.mapmy.town](https://storybook.mapmy.town/), separate from the
[production application](https://mapmy.town/). This documented destination does
not confirm deployment; local Storybook is the component validation path.
Existing `ideam.app` staging configuration remains unchanged.

The [controls guide](../design/controls.md) describes the controls and their
typed APIs, including validation and asynchronous recovery. **Components /
Dialog** demonstrates the dialog wrapper and its focus behavior.

## Validation boundary

Stories demonstrate component contracts and accessibility behavior. Component
checks cover focused interaction requirements; cross-system journeys belong in
browser tests. You should investigate visual differences and review intended
design changes before replacing baselines.

The [development guide](../contributor-guides/development-guide.md) shows how to
start Storybook locally on port 6006. The package's `build:storybook` script
produces the static catalog. You should review keyboard access, focus
restoration, labels, touch targets, long content, contrast, and narrow screens
using the [design system](../design/design-system.md).

Run `pnpm --filter @idea-map/web test:storybook-docs` to check the foundation
documentation's theme, typography, tables, and narrow-screen layout. The test
starts and stops its own Storybook server and requires Playwright Chromium or
`CHROME_PATH`.
