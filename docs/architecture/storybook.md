# Storybook architecture

Storybook is a tool for developing and exploring interface components in
isolation from the full application. You can use it to explore existing
components before building a new one. This guide explains how Idea Map's catalog
is organized, how stories show different component states, and how they support
design and testing. Storybook uses `@storybook/vue3-vite`; its
[configuration](../../apps/web/.storybook/main.js) loads component stories and
foundation documentation from `apps/web/stories/`.

Storybook is the source of truth for Idea Map's design system decisions and
authority. Its Foundations pages define shared visual and interaction choices;
its Components pages document component contracts, usage, and examples.

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

Usage-page preview cards use the shared surface, text, soft-border, and card
radius tokens, with no elevation. The toolbar updates those cards alongside the
surrounding documentation, including system-theme changes without a reload.
Isolated Canvas iframes inherit the owning documentation's theme without
reloading their examples. A story's explicit theme override takes precedence.

For device previews, open a component's story in Canvas and use **Viewport size**
in the toolbar. The catalog enables Storybook's built-in viewport tool with its
phone and tablet presets, rotation, and reset controls. Storybook does not show
the viewport tool on Usage documentation pages; **Components / Layout patterns**
includes an **Open device preview** link to its Canvas story. Isolated story
iframes are block elements so inline baseline spacing does not create an empty
scrollbar in a fixed-height Usage preview. The manager's viewport-size host does
not flex-shrink: phone/tablet preset heights remain exact even when the addon
panel leaves less space, and the surrounding preview scrolls instead.

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
documents independent Corners and Shadows sections, their tokens, and composable classes.

The selected production catalog address is
[storybook.mapmy.town](https://storybook.mapmy.town/), separate from the
[production application](https://mapmy.town/). This documented destination does
not confirm deployment; local Storybook is the component validation path.
Existing `ideam.app` staging configuration remains unchanged.

The **Components** usage pages describe controls and their APIs, including
validation and asynchronous recovery. **Components / Dialog** demonstrates the
dialog wrapper and its focus behavior.
The [Lordicon reuse record](lordicons.md) identifies the icon artwork and its
attribution and sharing conditions.

## Persistent-map layouts

The map-first catalog composes one persistent Google Maps canvas beneath its
navigation and foreground views. It is a component/layout reference, not an
adoption of that shell in the application's routes. Synthetic ideas represent
places: marker and result selection open the same Idea details view. Saved
ideas, New idea, profile, and settings use synthetic state. Submitted search
queries combine synthetic ideas with Google Places text search; the catalog does
not call application backends.

Desktop presentation uses a left navigation rail and a bounded left pane.
Automatic desktop presentation requires at least 1200 CSS px and a fine primary
pointer; touch-first layouts retain app-style navigation. Consumers can override
presentation explicitly. App presentation uses contextual search-bar actions,
a portrait bottom tray, and a landscape-tablet left pane. Close returns directly
to the map; Back restores the preceding view. Camera, query, draft fields, and
remembered sheet position survive those transitions while the shell is mounted.

Ordinary trays are nonmodal: they have no scrim, do not trap focus or dismiss on
map interaction, and allow simultaneous map panning and content interaction.
The existing `Dialog`, including its `placement="tray"` modal edge-panel option,
retains its focus containment and scrim for focused tasks. A modal may cover the
map temporarily but must not replace it. The general `PageLayout` remains a
document layout rather than becoming a map shell.

Bottom trays retain the predecessor's content-aware closed/medium/max states,
nearest-position drag snapping, directional flicks, fixed header, independent
body scrolling, and reduced-motion behavior. The 44 px grip target sits inside
the tray; the surface and map edge move together and preserve map pixels at the
rounded corners. The fading map-action row uses keyboard-scrollable badge
buttons. Current controls provide keyboard alternatives. Side panes use open/closed states and
preserve the remembered bottom-sheet position when orientation changes. Idea
selection uses the SDK's padded fit to reveal its location at the maximum map
zoom; the SDK determines whether a transition animates. Place selection uses a
same-zoom pan and a temporary marker. Subsequent manual camera movement does not
close the tray or trigger automatic recentering.

The provider boundary owns a single map instance per mounted shell and a single
SDK loader per document. Only map-layout stories initialize the real provider.
Explicit, non-production public browser configuration enables live maps; missing
configuration and provider failures remain visible rather than silently showing
a synthetic map. Places text search requires the existing project's Places API
(New) and transmits submitted queries to Google; provider results are labeled and
attributed separately. CI uses a deterministic injected adapter, with live-provider
validation reported separately. Do not provision resources, expose server
settings, request geolocation automatically, or obscure provider attribution.

## Validation boundary

Stories demonstrate component contracts and accessibility behavior. Component
checks cover focused interaction requirements; cross-system journeys belong in
browser tests. You should investigate visual differences and review intended
design changes before replacing baselines.

The [development guide](../contributor-guides/development-guide.md) shows how to
start Storybook locally on port 6006. The package's `build:storybook` script
produces the static catalog. You should review keyboard access, focus
restoration, labels, touch targets, long content, contrast, and narrow screens
using the Storybook Foundations and Components pages.

Run `pnpm --filter @idea-map/web test:storybook-docs` to check the foundation
documentation's theme, typography, tables, and narrow-screen layout. The test
starts and stops its own Storybook server and requires Playwright Chromium or
`CHROME_PATH`.
