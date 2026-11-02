# Design system

You can use Idea Map's design system to build components that look consistent
and work with a keyboard, on a small screen, and in either theme. The
[design specimen](specimen.html) lets you explore the palette, typography,
spacing, controls, and focus styles before you start.

The following contents links navigate within this guide:

- [Visual direction](#visual-direction)
- [Apply the tokens](#apply-the-tokens)
- [Dialog wrapper contract](#dialog-wrapper-contract)
- [Component discovery and verification](#component-discovery-and-verification)

## Visual direction

The design uses green map surfaces, cream text, sand selection, and rounded
controls. A darker light-theme accent supports readable white button text;
Poppins headings and Merriweather body text sit on flat surfaces. The
[migration history](../v1-migration/README.md) preserves predecessor references.

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
size. Radius tokens `--radius-small`, `-medium`, `-large`, and `-pill` express
control, card, panel, and pill shapes.

Both motion durations become zero under `prefers-reduced-motion: reduce`.
Components must honor these tokens or provide equivalent reduced-motion
behavior.

The following CSS pairs a surface, text, spacing, shape, and visible focus:

```css
.card {
  background: var(--color-surface);
  color: var(--color-text);
  padding: var(--space-6);
  border-radius: var(--radius-large);
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
