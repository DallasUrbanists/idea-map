# Playwright architecture

Browser tests help you check what happens when someone signs in, opens a dialog,
or loses their connection. This guide explains how Playwright runs those checks
with isolated servers, synthetic accounts, and controlled timers. The
[testing guide](../contributor-guides/testing-guide.md) has the commands,
prerequisites, manual checks, and cleanup steps.

The following contents links navigate within this guide:

- [Harnesses and isolation](#harnesses-and-isolation)
- [Time and behavior](#time-and-behavior)

## Harnesses and isolation

Authentication tests use the Firebase Auth emulator and synthetic accounts. The
server and browser test harnesses start temporary application servers on free
ports and stop them when the checks finish. The tests supply demo credentials
rather than reading private credentials from a developer's `.env`.

Playwright's separate Chromium installation provides a reproducible browser.
Dialog checks can use an installed Chrome through `CHROME_PATH`; contributors
should include that browser choice when reporting test results. The dialog
harness configuration lives under `apps/web/tests/dialog`.

## Time and behavior

Playwright's clock lets the authentication browser test advance renewal and
retry timers without waiting through each real-time interval. Browser checks
cover registration, verification, renewal, recovery, persistence, and
device-specific sign-out alongside server-session checks.

Dialog tests cover closed server rendering, modal keyboard/focus behavior, and
narrow viewports. You should also review screen-reader, touch-device, and
consumer-specific behavior; browser assertions do not replace those checks.

You should select meaningful user journeys, use deterministic fixtures, and keep
provider smoke checks separate from ordinary browser runs. You should
investigate a changed screenshot before replacing its baseline.
