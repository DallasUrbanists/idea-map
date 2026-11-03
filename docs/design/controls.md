# Controls and form components

You can build forms with the project-owned Vue controls and inspect their states
in Storybook under **Components**. The examples use synthetic content and the
shared light and dark foundation tokens.

The following contents links navigate within this guide:

- [Use the controls](#use-the-controls)
- [Component contracts](#component-contracts)
- [Validation and asynchronous feedback](#validation-and-asynchronous-feedback)
- [Review the specimens](#review-the-specimens)

## Use the controls

Nuxt discovers the components in `apps/web/app/components`. Other Vue consumers
must import the components and load `apps/web/src/styles/tokens.css` once. Each
component owns its scoped CSS, uses the light/dark semantic tokens, and keeps
keyboard focus visible independently of errors or selection.

This example binds a required title to a form-owned validation message:

```vue
<script setup lang="ts">
import { ref } from 'vue'
const title = ref('')
const error = ref('')
function validate() {
  error.value = title.value.trim() ? '' : 'Enter a title.'
}
</script>

<template>
  <form novalidate @submit.prevent="validate">
    <IdeaField v-model="title" label="Idea title" name="title"
      required :error="error" hint="Describe the improvement briefly." />
    <IdeaButton type="submit">Check title</IdeaButton>
  </form>
</template>
```

Consumers own validation timing, submission, authorization, and persistence.
Controls do not send requests, infer validity, or provide a security boundary.
Native required/type validation remains enabled unless the containing form uses
`novalidate`; the recovery specimen uses custom validation and focuses the first
invalid input after submission.

## Component contracts

The controls expose these typed APIs. Boolean flags default to false and optional
strings default to absent unless a default is listed. Fields, selects, and
toggles are controlled through `modelValue` and `update:modelValue` (`v-model`).

| Component | Props | Events and slots |
| --- | --- | --- |
| `IdeaButton` | `variant`: `primary` (default), `secondary`, or `danger`; `type`: `button` (default), `submit`, or `reset`; `disabled`; `loading`; `loadingLabel` (default `Saving…`) | `click(MouseEvent)` only when enabled and not loading; default slot supplies visible action text |
| `IdeaField` | Required `label` and string `modelValue`; optional `id`, `hint`, `error`; `type`: `text` (default), `email`, `password`, `search`, `tel`, or `url`; `multiline` chooses a textarea; `required`; `disabled` | `update:modelValue(string)` on input; `blur(FocusEvent)`; no slots |
| `IdeaSelect` | Required `label`, string `modelValue`, and readonly `options` array of `{ value, label, disabled? }`; optional `id`, `hint`, `error`; `required`; `disabled` | `update:modelValue(string)` on change; `blur(FocusEvent)`; no slots |
| `IdeaToggle` | Required `label` and Boolean `modelValue`; optional `id`, `hint`; `disabled` | `update:modelValue(boolean)` on change; no slots |
| `IdeaStatus` | `tone`: `info` (default), `success`, `warning`, or `error`; `live`: `off` (default), `polite`, or `assertive` | Default slot supplies the message and optional recovery action; no events |
| `IdeaProgress` | Required `label`; optional numeric `value`, `max` (default `100`), and `hint` | No events or slots |

Field, select, and toggle fallthrough attributes target the native control, so
`name`, `autocomplete`, `maxlength`, `readonly`, and native listeners work where
applicable. Component-owned IDs, values, types, disabled flags, and description
associations take precedence; use the typed props for those responsibilities.
Consumers should supply unique explicit IDs or let Vue generate SSR-stable IDs.

Field and select labels include visible required text and native `required`.
Hints and errors use `aria-describedby`; a nonempty error sets `aria-invalid`
and displays an explicit **Error:** prefix. Select options use native keyboard
and mobile behavior. Option values must be unique; include an empty-value option
when users must make an explicit choice.

The toggle is a native checkbox with switch semantics, a stable label, and visible
**On**/**Off** text. Space changes its state; its wrapping label supplies a target
at least 44 px tall. Use this component for Boolean settings, not agreement to
terms or a mutually exclusive radio group.

Buttons default to `type="button"` to avoid accidental form submissions. Native
`disabled` removes them from the tab order; `loading` uses `aria-disabled` and
`aria-busy`, preserves focus, changes the visible label, and blocks click and
native submit/reset activation. Consumers should also guard duplicate requests
in their submit handler, including submissions initiated outside the button.

Status messages include a symbol and a visible tone label, so meaning does not
depend on color. Static messages have live announcements disabled. Consumers
should mount an empty live region before updating its content, use `polite` for
ordinary feedback, and reserve `assertive` for urgent interruptions. The form
specimen uses one persistent polite region to avoid duplicate announcements.

Progress uses a labeled native `progress` element. Missing or nonfinite values
are indeterminate; finite values are clamped to zero through `max`. Missing,
nonfinite, zero, or negative maxima use `100`. The visible percentage complements
the native value; updates are not live announcements. The indeterminate pattern
is static, including under reduced motion, and forced-colors mode uses native
progress rendering.

## Validation and asynchronous feedback

You should keep user-entered values after a failed save, show an actionable error,
and allow retry. The **Validation and recovery** story demonstrates this flow
without requests: submit an empty title, enter a title, choose **Simulate failure**,
then **Try again** and **Simulate success**.

Consumers should focus the first invalid control after an unsuccessful submit,
and announce asynchronous completion or failure in a persistent live region.
Routine keystrokes should not repeatedly announce validation errors. A pending
button's loading label must describe the actual action, and any disabled action
should have a visible explanation when its availability is not obvious.

## Review the specimens

After [development setup](../contributor-guides/development-guide.md#one-time-setup-for-each-checkout),
run `pnpm dev:storybook` from the repository root and open
[local Storybook](http://localhost:6006). These isolated specimens need no database
or Firebase services. The selected production catalog destination is
[storybook.mapmy.town](https://storybook.mapmy.town/), separate from the production
[application](https://mapmy.town/); this selection does not confirm deployment.
Existing `ideam.app` staging configuration is unchanged.

You can review **Components / Examples / All States**, or use the individual
component stories. Use the Storybook theme toolbar to
choose system, light, or dark appearance. Check keyboard focus, long labels,
required and error descriptions, disabled controls, loading, and retry. Compare
light/dark system themes, forced colors, and narrow screens. The catalog includes
no production records or hosted operations.

Run `pnpm --filter @idea-map/web test:controls` for SSR relationships, keyboard
interaction, recovery, progress semantics, axe WCAG A/AA scans in light/dark
390 px and 1280 px viewports, and a 320 px forced-colors reflow check. Install
Playwright Chromium first, or set `CHROME_PATH` to an installed Chromium binary.
These checks do not replace screen-reader, real touch-device, or visual review.

To capture the same actual specimens, set `CAPTURE_SPECIMENS=1` when running the
test. In Bash, prefix the command with `CAPTURE_SPECIMENS=1`; in PowerShell, first
set `$env:CAPTURE_SPECIMENS = '1'`. The command writes four PNGs to
`docs/design/screenshots/`. These are review evidence, not approved visual
baselines. Review intended changes before replacing them. The test harness
starts and stops its own local server; stop Storybook with Ctrl+C if you started
it separately.
