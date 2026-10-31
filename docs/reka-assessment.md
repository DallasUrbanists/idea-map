# Reka interaction primitives assessment

Draft for review. Evaluated against Reka UI 2.11.0 and the project's Vue 3.5 /
Nuxt SSR baseline on 2026-10-31. Reka's [SSR guidance](https://reka-ui.com/docs/guides/server-side-rendering)
supports its primitives in Nuxt and explains the ID hydration caveat for Vue
before 3.5. This is upstream guidance, not proof that every wrapper or browser has
been tested. Project components must supply accessible names, styling, focus
indicators, responsive bounds and meaningful content; primitives do not remove
that responsibility ([accessibility guide](https://reka-ui.com/docs/overview/accessibility)).

| Primitive | Assessment and intended use | Keyboard / small-screen considerations |
| --- | --- | --- |
| [Dialog](https://reka-ui.com/docs/components/dialog) | Use a project-owned modal wrapper for focused, interruptive tasks; see `IdeaDialog`. Keep destructive confirmation and nonmodal panels separate. | Tab stays in the modal; Escape closes and restores trigger focus. Constrain the content to the viewport and scroll long content. Verify actual consumers and nested overlays. |
| [Popover](https://reka-ui.com/docs/components/popover) | Candidate for brief anchored interactive content, not navigation or an unnamed dialog. | Enter/Space and Escape, focus return and collision handling need consumer tests. Constrain width and height on narrow viewports; don't rely on hover. |
| [Dropdown menu](https://reka-ui.com/docs/components/dropdown-menu) | Candidate for action menus with menu semantics, not ordinary site links. | Arrow navigation, activation, Escape and focus restoration need tests; ensure touch targets and available viewport space. |
| [Select](https://reka-ui.com/docs/components/select) | Prefer native `select` for ordinary choices; consider Reka when a documented custom presentation is necessary. | Preserve a visible label, arrow navigation and selection. Check long options and scrolling on mobile. |
| [Combobox](https://reka-ui.com/docs/components/combobox) | Candidate for selection from filterable suggestions, such as a future search with an explicit contract. | Test input labelling, arrows, selection, Escape, empty results and asynchronous changes. Keep popup usable with the mobile keyboard. |
| [Tabs](https://reka-ui.com/docs/components/tabs) | Candidate for local panels; use links when navigation/URLs are the actual responsibility. | Test orientation, arrow keys, active tab and panel relationship. Avoid overflowing labels on narrow screens. |
| [Alert dialog](https://reka-ui.com/docs/components/alert-dialog) | Candidate for a consequential confirmation requiring a response; don't reuse the ordinary modal contract for it. | Verify safe initial focus and keyboard dismissal rules; allow long text to scroll on small screens. |
| [Tooltip](https://reka-ui.com/docs/components/tooltip) | Candidate for supplemental hints, never the only label or way to access essential information. | Verify focus and pointer access; touch users need an equivalent visible explanation. |

The table reports upstream behavior and proposed evaluation criteria. Only the
dialog wrapper below has been exercised in this change; the other candidates need
their own SSR, keyboard, touch and responsive tests when wrapped.

These candidates are recommendations, not implemented or approved components.
Build and test project wrappers in #36/#37 only when their concrete responsibilities
are known. Reka's [Autocomplete](https://reka-ui.com/docs/components/autocomplete)
is labelled **Alpha** upstream; its free-text semantics differ from selection in
Combobox. Do not adopt Alpha APIs without separate review. The upstream catalog
also labels Field, Form, Rating, Tag Group, color/date controls, Drawer and Tree
Alpha as of this assessment; recheck status before adoption. Native buttons,
inputs, checkboxes, radios and selects are preferred for simple responsibilities.

## Dialog wrapper contract

`IdeaDialog` provides a labelled modal with a trigger slot, required title and
description strings, a content slot and close button. It is uncontrolled and
intentionally does not expose the entire Reka API. Content is teleported; styles
are scoped to the rendered elements and use the project tokens; consumers must
load `apps/web/src/styles/tokens.css` once. Provide one native button in the
trigger slot, meaningful text, and accessible content. Do not
use it for alert dialogs or flows requiring an async save/close contract without
designing those semantics separately. The wrapper remains draft pending review.

Run `pnpm --filter @idea-map/web test:dialog` after installing dependencies and
Playwright Chromium (`pnpm --filter @idea-map/web exec playwright install chromium`).
The test can instead use an installed Chrome via `CHROME_PATH`. It checks the
closed server rendering, modal keyboard/focus behavior and a narrow viewport;
screen-reader, touch-device and individual consumer acceptance still require review.
