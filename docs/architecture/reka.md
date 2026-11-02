# Reka architecture

Building a dialog or menu means handling keyboard access and focus as well as
appearance. Reka UI supplies interaction primitives that you can use behind
project-owned components. This guide explains how to choose and wrap them; the
[design system](../design/design-system.md) covers component contracts, visual
tokens, and accessibility expectations.

The following contents links navigate within this guide:

- [Integration boundary](#integration-boundary)
- [Primitive responsibilities](#primitive-responsibilities)
- [Stability and verification](#stability-and-verification)

## Integration boundary

The package manifest pins Reka UI 2.11.0 with Vue 3.5 and Nuxt server-side
rendering (SSR). Reka's
[SSR guidance](https://reka-ui.com/docs/guides/server-side-rendering) describes
the identifier hydration caveat for Vue before 3.5. A project wrapper exposes
only what its component needs; it does not forward the entire primitive API.

Components must provide accessible names, meaningful content, visible focus,
responsive bounds, and styling. Primitives do not remove those responsibilities;
the
[upstream accessibility guide](https://reka-ui.com/docs/overview/accessibility)
explains their role. You should prefer native buttons, inputs, checkboxes,
radios, and selects when those elements cover the responsibility.

## Primitive responsibilities

You can use this table to choose a primitive and see which behavior to check:

| Primitive | Project responsibility | Required behavior |
| --- | --- | --- |
| [Dialog](https://reka-ui.com/docs/components/dialog) | Focused modal tasks through `IdeaDialog` | Focus containment, Escape dismissal, trigger-focus restoration, viewport bounds, and scrolling |
| [Popover](https://reka-ui.com/docs/components/popover) | Brief anchored interaction | Keyboard activation, Escape, focus return, collision handling, touch access, and bounded size |
| [Dropdown menu](https://reka-ui.com/docs/components/dropdown-menu) | Action menus with menu semantics | Arrow navigation, activation, Escape, focus restoration, and adequate touch targets |
| [Select](https://reka-ui.com/docs/components/select) | Choices requiring documented custom presentation | Visible labels, arrow navigation, selection, long-option handling, and mobile scrolling |
| [Combobox](https://reka-ui.com/docs/components/combobox) | Selection from filterable suggestions | Input labels, arrow navigation, selection, Escape, empty results, asynchronous updates, and mobile-keyboard space |
| [Tabs](https://reka-ui.com/docs/components/tabs) | Local content panels | Orientation, arrow navigation, active-tab/panel relationship, and labels that fit narrow screens |
| [Alert dialog](https://reka-ui.com/docs/components/alert-dialog) | Consequential confirmation requiring a response | Safe initial focus, appropriate dismissal rules, and scrolling on small screens |
| [Tooltip](https://reka-ui.com/docs/components/tooltip) | Supplemental hints | Focus and pointer access, with an equivalent visible explanation for touch users |

You should keep ordinary navigation as links, ordinary choices as native
`select` elements, and destructive confirmation separate from the modal wrapper.
Essential labels and instructions must remain available without tooltips or
hover. You should check actual component consumers and nested overlays
separately.

## Stability and verification

You should review upstream API maturity before adopting a primitive. Alpha APIs
require separate review; Autocomplete has free-text semantics distinct from
Combobox selection. Upstream maturity labels are external facts and require
verification against the exact version being adopted.

Each wrapper must preserve its documented SSR, keyboard, focus-restoration,
touch, and responsive behavior. You should test real consumers, nested overlays,
long content, asynchronous changes, and narrow viewports. You can find the
commands in the [testing guide](../contributor-guides/testing-guide.md).
