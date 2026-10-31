# Design tokens and themes

The proposed foundation is in `apps/web/src/styles/tokens.css`. Open
[`specimen.html`](design/specimen.html) in a browser to review palette,
typography, spacing, controls and keyboard focus. The web app is still a
placeholder; load the token stylesheet once from the application entry point when
it is integrated. The specimen loads Poppins and Merriweather from Google Fonts;
applications must load these fonts separately or use the fallback stacks.

## Reference and direction

The reference is committed v1 staging at
[`ee0552e3348a286b69e2540aa332217cdecd28cb`](https://github.com/DallasUrbanists/improvement-map/tree/ee0552e3348a286b69e2540aa332217cdecd28cb).
The [shared CSS](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/style.css)
provides the green map surfaces, cream text, sand selection and rounded controls;
the [theme service](https://github.com/DallasUrbanists/improvement-map/blob/ee0552e3348a286b69e2540aa332217cdecd28cb/src/services/theme.js)
provides light, dark and system choices. The proposal keeps those cues but uses a
darker light-theme accent for readable white button text, Poppins headings and
Merriweather body text, and flat surfaces instead of background textures.
These are proposed accessibility and consistency changes, subject to review.

## Using the tokens

- `--color-page`, `--color-surface`, and `--color-surface-raised` distinguish page,
  card, and raised surfaces. Pair `--color-text` or `--color-text-muted` with them;
  do not use a color alone to communicate status.
- Pair `--color-accent` with `--color-accent-text` for primary actions, and
  `--color-selection` with `--color-selection-text` for selected states.
  `--color-border`, `--color-focus`, and `--color-danger` cover boundaries, focus,
  and errors; provide text or icons alongside errors.
- Use `--font-heading` for headings and `--font-body` for body text. These specify
  Poppins and Merriweather, respectively, with sans-serif and serif fallbacks;
  `--font-mono` is a system monospace stack. The tokens name the fonts but do not
  load them. Provide Poppins 700 and Merriweather 400 and 700 when integrating the
  specimen's styles, along with any other weights or styles the application uses.
  `--font-size-small`, `--font-size-body`, `--font-size-heading`, and
  `--font-size-display` form the 14px / 16px / 24px / responsive 32–48px scale at
  the default root size. Use `--line-body` and `--line-heading` for readable lines.
- `--space-1`, `-2`, `-3`, `-4`, `-6`, `-8`, `-12` map to 4, 8, 12, 16, 24,
  32, 48px at the default root size. `--radius-small`, `-medium`, `-large`, and
  `-pill` express control, card, panel and pill shapes.
- `--motion-fast`, `--motion-standard`, and `--motion-ease` are opt-in transition
  values. Both durations become zero under `prefers-reduced-motion: reduce`;
  components must use these tokens or provide their own reduced-motion treatment.

For example:

```css
.card { background: var(--color-surface); color: var(--color-text); padding: var(--space-6); border-radius: var(--radius-large); }
.card a:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
```

Set `data-theme="light"` or `data-theme="dark"` on the root element to force a
theme. Omit the attribute or set `data-theme="system"` to follow the operating
system, including changes while the page is open. The specimen uses radio buttons
to demonstrate switching; persistence is application behavior and is not part of
this stylesheet. The tokens do not themselves style every component: consumers
must supply visible `:focus-visible` outlines, adequate target sizes, hover,
pressed, disabled and error states, and test their actual color pairings.

Representative text pairings meet at least 4.5:1 and focus/page and focus/surface
pairings exceed 3:1 in both themes. Contrast depends on the actual foreground and
background combination; check new pairings and non-text boundaries as components
are added. The specimen's controls use 44px minimum height and a 3px focus outline.
