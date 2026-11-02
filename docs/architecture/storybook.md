# Storybook architecture

You can explore existing components in Storybook before building a new one.
This guide explains how the catalog is organized, how stories show different
component states, and how they support design and testing. Storybook uses
`@storybook/vue3-vite`; its
[configuration](../../apps/web/.storybook/main.js) loads stories from
`apps/web/stories/**/*.stories.js`.

The following contents links navigate within this guide:

- [Catalog and styles](#catalog-and-styles)
- [Validation boundary](#validation-boundary)

## Catalog and styles

The [preview configuration](../../apps/web/.storybook/preview.js) imports the
project token stylesheet. Stories cover the actual project-owned components,
variants, composition patterns, and loading, empty, error, and disabled states.
Reka primitives do not automatically populate the catalog.

You should group stories by tokens, controls, forms, overlays, navigation and
layout, maps and media, and product patterns so other contributors can find
them. Document props, events, slots, and meaningful examples before creating
another overlapping component.

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
