# Design system

You can use Idea Map's design system to build components that look consistent
and work with a keyboard, on a small screen, and in either theme. The
[design specimen](specimen.html) lets you explore the palette, typography,
spacing, corner radii, elevation, controls, and focus styles before you start.

The following contents links navigate within this guide:

- [Visual direction](#visual-direction)
    - [Color rationale and roles](#color-rationale-and-roles)
    - [Balance and interaction states](#balance-and-interaction-states)
    - [Page background](#page-background)
    - [Theme mappings](#theme-mappings)
    - [Readable color pairings](#readable-color-pairings)
- [Apply the tokens](#apply-the-tokens)
- [Typography](#typography)
    - [Choose a text size](#choose-a-text-size)
    - [Wrap text intentionally](#wrap-text-intentionally)
- [Corner radius and elevation](#corner-radius-and-elevation)
    - [Choose a corner radius](#choose-a-corner-radius)
    - [Choose a shadow](#choose-a-shadow)
    - [Combine shape, elevation, and focus](#combine-shape-elevation-and-focus)
- [Borders](#borders)
    - [Border color and thickness](#border-color-and-thickness)
- [Margins, padding, and edge alignment](#margins-padding-and-edge-alignment)
    - [Choose spacing by relationship](#choose-spacing-by-relationship)
    - [Let content touch an edge](#let-content-touch-an-edge)
- [Dialog wrapper contract](#dialog-wrapper-contract)
- [Component discovery and verification](#component-discovery-and-verification)

## Visual direction

Common Ground draws its colors from a welcoming city neighborhood: broad
sidewalks, brick and glass buildings, street trees, transit, and public art.
Cool neutrals give ideas room to breathe. Blue anchors civic participation,
while coral, green, yellow, and lilac bring warmth, optimism, and imagination.
Poppins headings and Merriweather body text sit on flat surfaces with rounded
controls.

The specimen's color overrides live in [specimen.css](specimen.css), with page
paint and component surface rules in
[specimen-surfaces.css](specimen-surfaces.css), loaded afterward. These styles
apply only to the specimen. Application colors come from the shared token
stylesheet; the specimen demonstrates Common Ground without changing
application colors.

### Color rationale and roles

The following colors have distinct jobs in the Common Ground palette. You should
choose a color by its role and use the paired text color on filled areas.

| Color | Rationale | Use and limits | Text on the fill |
| --- | --- | --- | --- |
| Sidewalk `#F2F4F6` | Concrete and open sky make a quiet setting for varied ideas. | Light-theme page background and open space between sections; use Daylight for content surfaces. | Asphalt |
| Daylight `#FFFFFF` | Sunlit glass and library interiors suggest clarity and openness. | Light-theme cards, forms, and reading surfaces; use spacing and a border when their boundary matters. | Asphalt |
| Asphalt `#28323E` | Streets and structural steel give the palette a stable anchor. | Light-theme headings, body copy, and icons; keep large dark fills occasional so pages stay open. | Daylight |
| Transit blue `#3859C7` | Wayfinding and public transit suggest a shared civic purpose. | Primary actions, underlined links, and light-theme focus rings; keep secondary actions neutral and avoid blue decoration that competes with actions. | Daylight |
| Brick coral `#F17C67` | Older masonry and neighborhood murals add human warmth. | Small community-story labels and editorial illustrations; use the danger token for errors and destructive actions. | Asphalt |
| Canopy `#73A878` | Street trees and parks bring nature into the built environment. | Small nature-related editorial labels and illustrations; do not use it alone to communicate success or approval. | Asphalt |
| Marigold `#F3CB4C` | Sunshine and public art express optimism and invitation. | Brief editorial highlights and workshop prompts, plus dark-theme focus rings; reserve warning meaning for a labeled warning treatment. | Asphalt |
| Mural lilac `#B8A4DE` | Murals and creative spaces suggest possibility and imagination. | Selected items and small creative prompts; include a visible selection label or mark and keep unselected peers neutral. | Asphalt |

The supporting accent colors express tone; they do not define an idea's status
or a universal category legend. If a map or chart needs category colors, you
should define a stable mapping with text labels and additional shapes or symbols
where needed, and verify it against the actual basemap or chart background.

### Balance and interaction states

You should give neutral surfaces most of the area, make blue the main action
color, and use supporting accents sparingly. A page can use one supporting
accent without showing every palette color; long text belongs on neutral
surfaces. The swatch gallery shows the available colors, not their intended
proportion in an application screen.

You should keep the following interaction roles consistent:

- Use `--color-accent` and `--color-accent-text` for the main action in a local
  group; use neutral surfaces and a visible border for secondary actions.
- Keep links underlined so color is not their only identifying feature.
- Pair `--color-selection` with `--color-selection-text` for selection and add a
  visible label or mark; expose selection through the control's appropriate
  native or ARIA state.
- Use `--color-focus` for a 3px outline with space around the control; selection
  and keyboard focus must remain independently visible.
- Use `--color-danger` with an explicit message for errors and destructive
  actions; decorative coral, canopy, and marigold do not substitute for status.
- Verify hover, pressed, and disabled treatments against their actual surfaces;
  do not reduce text opacity without checking readability, and expose disabled
  controls through native or ARIA semantics.

### Page background

The specimen page uses a subtle, static three-shade gradient from left to right.
The cool neutral shifts add depth without competing with ideas or the palette's
supporting accents. Dark mode uses closely spaced neutral charcoal shades. The
following stops blend continuously at 0%, 50%, and 100%.

| Theme | Start | Middle | End |
| --- | --- | --- | --- |
| Light | `#F2F4F6` | `#F0F2F8` | `#EAF1F2` |
| Dark | `#222426` | `#242628` | `#26282A` |

You should apply this treatment only to the page canvas. Cards, controls,
floating panels, and reference swatches keep their opaque fills. Use the same
three stops throughout a page without restarting the gradient at each section,
and keep it static. The solid `--color-page` remains the fallback; forced-colors
mode removes the gradient so system colors can determine the page treatment.

The gradient stops are local specimen variables named `--specimen-page-start`,
`--specimen-page-middle`, and `--specimen-page-end`. Only
`--specimen-page-background` contains a gradient, and only `body` consumes it as
a background image. The `--color-page`, `--color-surface`, and
`--color-surface-raised` tokens remain opaque colors; a surface must not use
`background: inherit` or inherit the page paint token. The page token remains
the base shade, so the theme mappings below still describe the solid fallback.
You should check page text and focus contrast against all three shades and
their blends rather than checking only that base token.

You should give every bounded component an explicit fill. Cards, the theme
picker, tables, radius samples, form fields, and edge-to-edge content containers
use `--color-surface`; floating examples and inset row backgrounds use
`--color-surface-raised`. Editorial media and palette swatches use their own
opaque colors. Layout wrappers such as `main`, sections, and grids remain
transparent so they expose the page canvas around the components. Transparency
inside rounded corners and outside shadows is part of the page, not the
component interior.

### Theme mappings

The specimen keeps the eight base swatches constant for reference. Its semantic
colors adapt the surrounding interface to each theme; dark mode uses slate
surfaces, light text, and lighter blue actions. The following values are the
specimen's mappings, not replacements for the application stylesheet.

| Semantic token | Light theme | Dark theme |
| --- | --- | --- |
| `--color-page` | `#F2F4F6` | `#222426` |
| `--color-surface` | `#FFFFFF` | `#26313E` |
| `--color-surface-raised` | `#E8EDF3` | `#303E4E` |
| `--color-text` | `#28323E` | `#F2F4F6` |
| `--color-text-muted` | `#56616E` | `#BEC8D4` |
| `--color-border` | `#7B8794` | `#8391A2` |
| `--color-accent` | `#3859C7` | `#9EB5FF` |
| `--color-accent-text` | `#FFFFFF` | `#1C242E` |
| `--color-selection` | `#B8A4DE` | `#B8A4DE` |
| `--color-selection-text` | `#28323E` | `#28323E` |
| `--color-focus` | `#3859C7` | `#F3CB4C` |
| `--color-danger` | `#9B2727` | `#FFB4A9` |

You should use semantic tokens in interface examples instead of copying base
hex values into controls. The specimen's `--specimen-*` variables identify its
fixed reference swatches and editorial accents; they are local to the specimen
and are not application token APIs. Fixed coral, canopy, marigold, and lilac
fills retain Asphalt text in both themes, rather than inheriting light text
from the dark-theme page.

### Readable color pairings

The following opaque base-color pairings meet the 4.5:1 minimum for ordinary
text, with ratios rounded to two decimal places.

| Text | Background | Contrast |
| --- | --- | --- |
| Asphalt | Sidewalk | 11.79:1 |
| Asphalt | Daylight | 12.99:1 |
| Daylight | Transit blue | 6.14:1 |
| Asphalt | Brick coral | 4.84:1 |
| Asphalt | Canopy | 4.70:1 |
| Asphalt | Marigold | 8.33:1 |
| Asphalt | Mural lilac | 5.82:1 |

You should use Asphalt text on the four supporting fills; white text does not
meet 4.5:1 on those colors. Supporting colors are also unsuitable as small text
on white. Use the accent token for links, and keep accent-colored labels on
their specified fills.

You should check actual foreground/background combinations in both themes,
including hover and selection states. Ordinary text needs at least 4.5:1;
essential control boundaries and focus indicators need at least 3:1 against
adjacent colors. A color value alone does not guarantee contrast when opacity,
images, or another surface changes the background.

## Apply the tokens

The token stylesheet lives in `apps/web/src/styles/tokens.css`, and the
application loads it once from its entry point. The specimen loads Poppins and
Merriweather from Google Fonts; applications must load these fonts separately or
use the fallback stacks.

When you build a component, you should use the tokens consistently:

- Pair `--color-page`, `--color-surface`, and `--color-surface-raised` with
  `--color-text` or `--color-text-muted`, and do not communicate status by color alone.
- Pair `--color-accent` with `--color-accent-text`, and `--color-selection` with
  `--color-selection-text`.
- Use `--color-border`, `--color-focus`, and `--color-danger` for boundaries,
  focus, and errors, with text or icons alongside errors.
- Use `--font-heading` for headings, `--font-body` for body text, and
  `--font-mono` for literal code.
- Use `--line-body` and `--line-heading` for readable text.
- Use the spacing and radius scales for consistent layout and control shapes.
- Choose shadows by the surface's [elevation role](#choose-a-shadow), keeping
  ordinary content flat and focus outlines independent of shadows.
- Use `--motion-fast`, `--motion-standard`, and `--motion-ease` for opt-in
  transitions, or supply an equivalent reduced-motion treatment.

Headings use Poppins with sans-serif fallbacks, and body text uses Merriweather
with serif fallbacks. Monospace text uses system fonts. Tokens do not load
fonts. Applications must load Poppins 700 and Merriweather 400 and 700, plus any
other weights or styles they use, or use the fallback stacks.

The font-size tokens `--font-size-small`, `--font-size-body`,
`--font-size-heading`, and `--font-size-display` form the 14 px, 16 px, 24 px,
and responsive 32–48 px scale. Spacing tokens `--space-1`, `-2`, `-3`, `-4`,
`-6`, `-8`, and `-12` map to 4, 8, 12, 16, 24, 32, and 48 px at the default root
size. The radius roles below use `--radius-small` for controls and compact
surfaces, `--radius-medium` for content containers, and `--radius-pill` for short
metadata. The shared stylesheet also exports `--radius-large` at 16 px; Common
Ground assigns no standard component role to that value.

Both motion durations become zero under `prefers-reduced-motion: reduce`.
Components must honor these tokens or provide equivalent reduced-motion
behavior.

The following CSS pairs a surface, text, spacing, shape, and visible focus:

```css
.card {
  background: var(--color-surface);
  color: var(--color-text);
  padding: var(--space-6);
  border-radius: var(--radius-medium);
}
.card a:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}
```

To choose a theme, you should set `data-theme="light"` or `data-theme="dark"` on
the root element to force a theme. Omit the attribute or set
`data-theme="system"` to follow the operating system, including changes while
the page is open. The specimen uses radio buttons to demonstrate switching;
persistence is application behavior and is not part of this stylesheet. The
tokens do not themselves style every component: consumers must supply visible
`:focus-visible` outlines, adequate target sizes, hover, pressed, disabled, and
error states, and test their actual color pairings.

Representative text pairings meet at least 4.5:1 and focus/page and
focus/surface pairings exceed 3:1 in both themes. Contrast depends on the actual
foreground and background combination. When you add a new pairing or non-text
boundary, you should check its contrast. The specimen's
controls use 44 px minimum height and a 3px focus outline.

## Typography

Typography gives an idea a clear reading order. You should use Poppins 700 for
headings, Merriweather 400 for reading text, Merriweather 700 for emphasis and
control labels, and the system monospace stack for literal code. Size and
spacing establish hierarchy together; secondary text still needs readable
contrast. The specimen demonstrates the following roles in both themes.

### Choose a text size

You should use the following scale. Pixel equivalents assume a 16 px root font
size; rem values preserve the reader's font-size settings.

| Role | Size and line height | Use |
| --- | --- | --- |
| Display or page title | `--font-size-display`: `clamp(2rem, 4vw, 3rem)` / 32–48 px; 1.2 | Main page title or brief introductory statement, using Poppins 700 |
| Section heading | `--font-size-heading`: `1.5rem` / 24 px; 1.2 | Major sections, using Poppins 700 |
| Subheading | `1.25rem` / 20 px; 1.2 | Subsections and prominent card titles, using Poppins 700 |
| Compact heading | `--font-size-body`: `1rem` / 16 px; 1.2 | Small groups, dense card titles, or field-group headings, using Poppins 700 |
| Lead paragraph | `1.125rem` / 18 px; 1.55 | A brief introduction, using Merriweather 400; regular paragraphs return to body size |
| Body, lists, and table content | `--font-size-body`: `1rem` / 16 px; 1.55 | Reading text and essential instructions, using Merriweather 400 |
| Buttons, fields, and field labels | `--font-size-body`: `1rem` / 16 px; 1.55 | Controls and their labels; button labels use weight 700 and targets remain at least 44 px |
| Supporting text | `--font-size-small`: `0.875rem` / 14 px; 1.55 | Captions, timestamps, helper text, compact metadata, and eyebrows; essential instructions remain body size |
| Literal code | `--font-size-small`: `0.875rem` / 14 px; 1.55 | Hex values, token names, and short code examples in the monospace stack |

The specimen defines the 20 px and 18 px roles locally as
`--specimen-font-size-subheading` and `--specimen-font-size-lead`; these extend
the examples without adding shared application tokens. You should use the
existing shared size tokens wherever a role already has one, and avoid adding
intermediate sizes without a distinct reading purpose.

You should choose heading levels by document structure, not by their visual
size. A compact card title can be an `h3` with a compact-heading class; it does
not become an `h4` merely to obtain smaller text. Use one page-level `h1` and
nest section headings without skipping levels. Body text stays at 16 px on
small screens, and editable controls stay at least 16 px. Supporting text
should not shrink below 14 px to fit more content.

You should keep reading paragraphs around 45–70 characters per line where the
layout allows, using a maximum inline size such as `65ch`. Narrow cards can
have shorter lines. Use unitless line heights, let containers grow with their
content, and verify reflow with enlarged text; clipping or truncating essential
copy is not a substitute for adequate space.

### Wrap text intentionally

You should apply `text-wrap: pretty` to paragraphs and other text where wrapping
is expected and possible: headings, descriptions, list items, definition lists,
captions, table prose, helper text, links, and multiline labels or button text.
The specimen sets it on `body` so ordinary text inherits the rule, including
text added later. This gives the browser room to improve line endings without
requiring a specific break or guaranteeing an identical result in every font.

You should let natural wrapping determine prose line breaks rather than adding
`<br>` for a particular screen width. Use deliberate line breaks only when
structure requires them, such as an address or verse. Browsers that do not
support `pretty` retain ordinary wrapping; content must remain readable there.

You should keep exceptions narrow: a short color-chip/code pair or an atomic
identifier can stay on one line when it fits, while long URLs and identifiers
can use `overflow-wrap: anywhere` to prevent overflow. Literal preformatted
code retains its whitespace and uses local horizontal scrolling if necessary.
Single-line inputs retain their native behavior. Avoid applying `white-space:
nowrap` to whole cards, paragraphs, or action groups; action groups should wrap
their controls and multiline labels should allow their controls to grow.

The following example applies the default to readable text while keeping code
and atomic color labels deliberate. You should use the same rules in both
themes.

```css
body {
  font-size: var(--font-size-body);
  line-height: var(--line-body);
  text-wrap: pretty;
}
.reading-copy {
  max-inline-size: 65ch;
}
.color-code {
  text-wrap: nowrap;
}
code {
  overflow-wrap: anywhere;
}
pre {
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}
```

## Corner radius and elevation

Corner radius gives related elements a consistent shape. Drop shadows indicate
that a surface floats above other content. You should choose these properties
independently: a rounded card can remain flat, and an overlay does not need a
larger radius simply because it is elevated. The specimen demonstrates both
properties using the shared radius tokens and local shadow recipes.

### Choose a corner radius

You should use the following roles consistently. Pixel equivalents assume the
default 16 px root font size; the rem values scale with the root font size.

| Value | Role | Guidance |
| --- | --- | --- |
| `0` | Continuous or joined edges | Tables, adjoining segments, full-width map canvases, and small reference color chips stay square. Round only exposed outer corners of a joined group. |
| `--radius-small`: `0.5rem` / 8 px | Controls, labels, and compact surfaces | Buttons, fields, labels, selection highlights, theme pickers, swatches, popovers, and dialogs share this radius. Elevation is a separate choice. |
| `--radius-medium`: `0.75rem` / 12 px | Content containers | Reading cards and substantial panels use this radius. Avoid adding rounded containers around every paragraph or row. |
| `--radius-pill`: `999px` | Short standalone metadata | Compact tags or counts can use a pill shape. Ordinary action buttons and form fields retain the small radius. |

You should keep matching components at the same radius in both themes and all
interaction states. Shape alone must not communicate selection, status, or
clickability. Circular avatars and circular map markers follow their own
geometry rather than the rectangular corner scale.

For nested surfaces, you should keep the inner radius no larger than the outer
radius. A 12 px card containing an 8 px control with at least 4 px of inset is a
useful pairing; prefer spacing over adding another framed surface. Full-bleed
images should follow the container's exposed corners. Clip the image itself
rather than clipping a whole container that contains focusable controls or
floating content.

### Choose a shadow

The default surface is flat. You should use borders, spacing, and surface color
to distinguish content in the document flow, and add a shadow only when content
actually floats over another surface. The following recipes use CSS pixel
lengths and remain the same size in both themes; only shadow color changes.

| Level | Use | Light-theme recipe | Dark-theme recipe |
| --- | --- | --- | --- |
| Flat | Page sections, cards, buttons, form fields, and selected items | `none` | `none` |
| Floating | Popovers, menus, and controls floating over a map | `0 4px 12px rgb(28 36 46 / 14%)` | `0 4px 12px rgb(0 0 0 / 32%)` |
| Overlay | Modal dialogs above the page | `0 12px 32px rgb(28 36 46 / 22%)` | `0 12px 32px rgb(0 0 0 / 48%)` |

You should use an opaque surface and a visible border on floating and overlay
panels in both themes. Dark-theme surfaces need that border because a dark
shadow alone can disappear into the page. A modal backdrop provides background
separation; its dialog still needs a labeled modal contract, focus management,
and an appropriate stacking order. A shadow does not establish modal behavior
or stacking order.

The specimen defines these recipes as `--specimen-shadow-flat`,
`--specimen-shadow-floating`, and `--specimen-shadow-overlay` in
[specimen-surfaces.css](specimen-surfaces.css). These variables are specimen examples, not shared
application tokens; the shared stylesheet exports the radius scale but does not
export shadow tokens. These documentation examples do not add shadows to
application components.

### Combine shape, elevation, and focus

You should keep the following rules when applying shape and elevation:

- Use the component's role to choose its radius and its relationship to the
  page to choose its shadow; a popover uses small radius and floating shadow,
  while a reading card uses medium radius and no shadow.
- Keep shadows stable across hover, pressed, selected, and disabled states;
  use the component's surface, border, and semantic state for feedback instead
  of making cards appear to lift on hover.
- Preserve the visible 3px focus outline and its 3px offset independently of
  box shadows; neither a shadow nor a colored glow substitutes for focus.
- Leave enough space for a floating surface's shadow and focus outlines; avoid
  clipping them with ancestor overflow rules.
- Preserve borders and semantic state when shadows are unavailable, including
  forced-colors mode; a shadow must not be the only way to identify a control
  boundary, selection, or status.
- Keep radius and shadow changes out of interaction animations; motion settings
  continue to govern any other transitions.

The following specimen example combines a floating surface with independent
focus styling. The same surface and border pair remains necessary when the
shadow is unavailable.

```css
.floating-example {
  background: var(--color-surface-raised);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  box-shadow: var(--specimen-shadow-floating);
}
.floating-example :focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}
```

## Borders

Borders clarify a boundary when spacing or surface color is insufficient. You
should keep structural borders quiet and reserve stronger edges for controls
and meaningful states. A reading card does not need a border if its background
and surrounding space already establish the group.

### Border color and thickness

The specimen separates decorative structure from essential control boundaries
using the following colors. The subtle colors are specimen variables; the
functional colors use the existing `--color-border` token.

| Role | Light | Dark | Thickness and use |
| --- | --- | --- | --- |
| Subtle structure: `--specimen-border-subtle` | `#D7DEE6` | `#465463` | 1 px for optional card outlines, section dividers, table rules, swatch edges, and floating-panel outlines |
| Functional boundary: `--color-border` | `#7B8794` | `#8391A2` | 1 px for fields and outlined buttons where the edge identifies the control |
| State emphasis | Accent or danger token with a label | Accent or danger token with a label | 2 px when a selected or invalid boundary needs emphasis; reserve the space in every state to avoid layout shifts |
| Keyboard focus | `--color-focus` | `--color-focus` | 3 px outline with 3 px offset, independently visible around the control |

You should start with no border, then use a 1 px subtle rule if a boundary helps
readers understand grouping. Use a single shared divider between adjoining
items instead of outlining every item, and avoid double borders where surfaces
meet. Borders should remain solid; dashed outlines belong only to an explicitly
labeled interaction such as a drop target. You should not reduce the opacity
of an entire component to make its border quieter.

You should retain at least 3:1 contrast against adjacent surfaces when a border
is necessary to identify a control or state. Subtle decorative dividers do not
serve that role and need not meet 3:1; they must not become the sole indication
of selection, error, or clickability. A stronger border is appropriate where
the actual surface pairing requires it, including over maps or images. In
forced-colors mode, controls retain native semantics and visible system-colored
boundaries; decorative colors and shadows must not carry essential meaning.

## Margins, padding, and edge alignment

Spacing expresses relationships. You should use margin for space outside a
component, padding for space inside it, and layout `gap` between siblings. One
container should own each gap so adjacent margins and padding do not add an
accidental second layer of space.

### Choose spacing by relationship

You should choose spacing from the shared scale, using these defaults as a
starting point rather than inventing a value for each component.

| Relationship | Default | Use |
| --- | --- | --- |
| Closely related details | 4 px / `--space-1` | Icon-to-label gaps and color-chip-to-code gaps |
| Labels and compact items | 8 px / `--space-2` | Field label to input, metadata groups, and neighboring actions |
| Control interior | 8 px block, 12–16 px inline | Buttons and fields; retain at least a 44 px target even when padding is compact |
| Related content | 16 px / `--space-4` | Paragraph spacing, related controls, and mobile container padding |
| Content container interior | 24 px / `--space-6` | Desktop cards and panels; use 16 px on narrow screens |
| Separate groups | 24–32 px / `--space-6`–`--space-8` | Sections within a page and gaps between cards |
| Page gutters and major sections | 32 px desktop, 16 px mobile; 48 px for major separation | Align page content to a shared gutter and use larger gaps for unrelated sections |

You should align headings, body copy, and controls to the same content inset.
The gap within a group should be smaller than the gap separating it from the
next group. Avoid fixed heights for text containers, let action rows wrap, and
keep these relationships when text is enlarged or translated. Spacing may
shrink at a narrow breakpoint, while control targets remain at least 44 px.

### Let content touch an edge

Edge-to-edge content expresses continuity or gives media the full available
width. You should use it deliberately for a card's cover image, a map or media
canvas, a section background band, a divider, or the background of a selected
row. Reading text, field labels, and button groups retain their normal inset.

You should apply the following rules when content touches an edge:

- Put full-width media or a row background directly inside the unpadded outer
  container, then put its text and controls in a separately padded child.
- Extend a selected row's background or divider to the container edge while
  aligning its text with neighboring rows; an inset divider can instead align
  with text when it separates only that text group.
- Let a page-wide background reach the viewport edges while its inner content
  follows the shared page gutter and maximum width.
- Match exposed media corners to the container, keep adjoining interior edges
  square, and clip media itself instead of an ancestor containing focusable
  elements or floating surfaces.
- Reserve room for focus outlines and shadows; interactive controls at an edge
  still need inset for their targets and focus indicators, including mobile
  safe-area space where applicable.
- Use layout structure to create full-width areas instead of negative margins
  that depend on a parent's padding, and verify that edge treatments do not
  introduce horizontal overflow.

The following card structure lets media touch the top and side edges while
keeping reading content inset. The specimen shows the same pattern with a
full-width row background and inset row text.

```html
<article class="edge-card">
  <div class="edge-media">Full-width media</div>
  <div class="edge-copy">Inset heading, text, and controls</div>
  <div class="edge-row">Full-width row background, inset text</div>
</article>
```

## Dialog wrapper contract

`IdeaDialog` provides a labeled modal with a trigger slot, required title and
description strings, a content slot, and a close button labeled **Close**. The
**Close** button has a 44 px touch target and a visible keyboard focus
indicator. The header reserves room for it when long titles wrap.

The wrapper has no bottom close button. Clicking **Close** or pressing Escape
closes the modal and restores focus to its trigger. The wrapper manages its own
open state and exposes only the API it needs.

Content is teleported; styles are scoped to the rendered elements and use the
project tokens; consumers must load `apps/web/src/styles/tokens.css` once.

When you use the wrapper, you should provide one native button in the trigger
slot, meaningful text, and accessible content. Do not use it for alert dialogs
or flows requiring an asynchronous save/close contract without designing those
semantics separately.

## Component discovery and verification

You should inspect existing components and stories before adding another
component. Use the [Reka guide](../architecture/reka.md) for primitive
selection, the [Storybook guide](../architecture/storybook.md) for catalog
organization, and the [testing guide](../contributor-guides/testing-guide.md)
for checks.
