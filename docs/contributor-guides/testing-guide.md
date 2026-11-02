# Testing guide

When you change something in Idea Map, tests help you check that it behaves as
intended. This guide helps you choose the checks for your change and recognize
a successful result. Contributors should start with a test of the behavior they
changed; a renderer change needs a renderer test, while a wording change needs
a careful read and a link check.

The
[documentation review checklist](documentation-style-guide.md#documentation-review-checklist)
covers wording changes; code changes need the checks relevant to their behavior.

The following contents links navigate within this guide:

- [Everyday checks](#everyday-checks)
- [Package tests](#package-tests)
- [Database tests](#database-tests)
- [UI changes](#ui-changes)
- [Dialog checks](#dialog-checks)
- [In your pull request](#in-your-pull-request)
- [Authentication testing](#authentication-testing)
    - [Authentication test setup](#authentication-test-setup)
    - [Start authentication testing](#start-authentication-testing)
    - [Register and verify in the original tab](#register-and-verify-in-the-original-tab)
    - [Renew and recover an open session](#renew-and-recover-an-open-session)
    - [Check persistence and device-specific logout](#check-persistence-and-device-specific-logout)
    - [Reset a password](#reset-a-password)
    - [Google sign-in and keyboard access](#google-sign-in-and-keyboard-access)
    - [Optional: automated regression checks during a session](#optional-automated-regression-checks-during-a-session)
    - [Finish authentication testing](#finish-authentication-testing)

## Everyday checks

You should use the Node.js and pnpm versions in the
[contributing guide](../../CONTRIBUTING.md#run-locally), then run
`pnpm install --frozen-lockfile` from the repository folder.

These root commands check code and shared configuration:

| Command | What it does |
| --- | --- |
| `pnpm lint` | Checks that application and package imports follow the workspace rules. |
| `pnpm test` | Runs the root tests in `scripts/`. |
| `pnpm typecheck` | Builds workspace TypeScript and checks Nuxt types. |
| `pnpm build` | Builds workspace TypeScript and the production Nuxt app. |
| `pnpm test:web` | Starts and checks the built web server. Run `pnpm build` first. |

You should run these before requesting review for code or shared configuration
changes. The root test command doesn't include every package test.

For documentation changes, you should follow the
[documentation review checklist](documentation-style-guide.md#documentation-review-checklist).

## Package tests

You should run the test for the package you changed.

For the street renderer:

```sh
pnpm exec tsc --build
pnpm --filter @idea-map/street-renderer test
```

For Streetmix:

```sh
pnpm --filter @idea-map/streetmix test
```

The Streetmix test builds the package and uses a fake provider, so it doesn't
need a live Streetmix service.

For import-rule changes, you should run
`node --test scripts/boundaries.test.mjs`. The
[workspace guide](../architecture/architecture-overview.md) explains those
rules.

## Database tests

You should use an **empty, disposable PostGIS database** whose name starts with
`idea_map_test_`. These tests create records and run migrations. Never use a
shared or production database.

To test the database schema, you should set `TEST_DATABASE_URL` to that
database's connection string and run:

```sh
pnpm exec tsc --build
pnpm --filter @idea-map/server test:database
```

You should check that server-rendered pages show only approved ideas:

1. Create a separate empty test database.
2. Set `DATABASE_URL` to its connection string and run
    `pnpm --filter @idea-map/server db:migrate`.
3. Load `packages/server/test/ssr-fixture.sql` into it using your PostgreSQL
    client. This fixture contains synthetic ideas for the test.
4. Set `TEST_DATABASE_URL` to the same connection string.
5. Run `pnpm build`, then `pnpm test:web:published`.

You should use the [development guide](development-guide.md) for local PostGIS
setup. This published-page check verifies that both an idea and its displayed
revision are approved before the page shows the title and description. It also
checks public HTML cache headers, credential-bearing requests, and the origin
response after a synthetic withdrawal. The [Hosting cache guide](../architecture/hosting-cache.md)
describes provider checks and their limitations.

The check restores the synthetic idea after its withdrawal assertion. If the test
process is interrupted before cleanup, contributors should inspect and restore
that fixture in the disposable test database before reusing it.

## UI changes

You should look for an existing Storybook example before adding a new one. Check
the states your change affects, such as loading, empty results, or errors. Try
the keyboard and a small screen as well.

You should include screenshots when they help a reviewer understand the result.
If a visual test changes, investigate the difference and get the intended design
reviewed before updating its baseline.

You should use the [design system](../design/design-system.md) for component and
accessibility guidance. The catalog shows what each component does; its stories
and user journeys show the behavior you can check.

## Dialog checks

You should check dialog server-side rendering (SSR), keyboard/focus behavior,
and narrow layouts:

1. Complete development setup and install Playwright Chromium with
    `pnpm --filter @idea-map/web exec playwright install chromium`.
2. Run `pnpm --filter @idea-map/web test:dialog`.
3. Review screen-reader, touch-device, nested-overlay, and consumer-specific
    behavior.

The test can use an installed Chrome through `CHROME_PATH` instead of downloaded
Chromium. The harness starts and stops its test servers. You should stop any
services you separately started using the
[development shutdown steps](development-guide.md#end-of-each-work-session).

## In your pull request

You should report validation using the
[review-description standards](documentation-style-guide.md#review-descriptions-and-release-notes).

## Authentication testing

You should use the Firebase Auth emulator to check registration, verification,
session recovery, password reset, and sign-out with synthetic accounts. The
emulator sends no real email; action links appear in its logs.

### Authentication test setup

You should prepare the application and browser with these steps:

1. Complete
    [local development setup](development-guide.md#one-time-setup-for-each-checkout),
    including dependencies and the root `.env` file.
2. Keep the example's local demo settings, which need no hosted Firebase project
    or real credentials.
3. Choose a Chromium browser, such as Chrome or Edge, for the developer-tools
    checks.
4. Optional: To run the automated browser test, install Playwright's separate
    Chromium browser:

    ```sh
    pnpm --filter @idea-map/web exec playwright install chromium
    ```

### Start authentication testing

You should start the app, watch emulator messages, and prepare developer tools:

1. Follow the
    [development session-start steps](development-guide.md#start-of-each-work-session)
    to start and check services and run `pnpm dev`.
2. Open <http://127.0.0.1:3000/account>, keeping this exact origin throughout
    the tests.
3. Watch Firebase logs in another terminal at the repository root:

    ```sh
    pnpm dev:logs firebase
    ```

4. Open the browser's developer tools with F12.
5. In **Network**, enable **Preserve log** and filter for `session`.
6. In **Console**, run this whenever a test asks you to check server status:

    ```javascript
    await (await fetch('/api/session')).json()
    ```

Before signing in, server status is `{ registered: false }`.

When the app requests verification or a password reset, the log terminal prints
the account's email address and an action URL. You should open that URL to
simulate the email action; there is no real email or emulator dashboard in this
setup.

### Register and verify in the original tab

You should check that email verification updates the original account tab:

1. Enter a unique synthetic email, such as `manual-account@example.test`, and a
    test password of at least six characters.
2. Click **Create account**.
3. Confirm the signed-in message and verification-email confirmation appear,
    then compare server status with the following expected results.
4. In the log terminal, find **To verify the email address** for the email you
    registered.
5. Copy the complete URL after **follow this link** and open it in a new browser
    tab.
6. Confirm the emulator reports successful verification.
7. Within four minutes of registration, reload the **original account tab** and
    wait for a successful `POST` /api/session .
8. Check server status and confirm it reports a verified email without signing
    in again.
9. In **Application > Cookies**, inspect the site's `__session` cookie against
    the following expected flags.

You can compare your results with these checkpoints for registration,
verification, and cookie creation:

| Checkpoint | Expected result |
| --- | --- |
| After registration | “Signed in as …” and “Check your email for a verification link.” |
| Server status before verification | `{ registered: true, emailVerified: false }` |
| Verification URL | Starts with `http://127.0.0.1:9099/emulator/action?mode=verifyEmail` and includes the emulator-generated action code. |
| Server status after verification and immediate reload | `{ registered: true, emailVerified: true }` |
| Session cookie | `HttpOnly`, `Secure`, `SameSite=Lax`, and an expiry about 14 days away. |

The immediate reload checks for cached pre-verification claims. If you need a
new link, you should click **Send verification email** and repeat steps 4–6
using the newest log entry for that address.

### Renew and recover an open session

You should check scheduled renewal and recovery from a temporary disconnection:

1. Keep the signed-in tab open for 50 minutes without reloading.
2. Confirm a successful `POST /api/session`, a new `Set-Cookie` response, and a
    later cookie expiry while remaining signed in.
3. Switch to another application and back, then confirm another successful
    session `POST`.
4. In DevTools **Network**, select **Offline**, then switch away and back.
5. Confirm the following refresh error appears while the signed-in identity
    remains visible.
6. Stay offline for at least one minute and confirm another failed refresh
    attempt.
7. Select **No throttling** and wait for the browser's online event or the next
    one-minute retry.
8. Confirm a successful session `POST` and that the refresh error clears.

The account page displays this error:

> Your server session could not be refreshed. Retrying automatically, or sign out.

Browser background throttling can delay timers. Steps 1–2 test scheduled
renewal, while step 3 tests focus recovery without waiting 50 minutes.

### Check persistence and device-specific logout

You should verify that reload preserves identity and sign-out affects only one
browser:

1. Reload while signed in and confirm the identity and registered server status
    persist.
2. Open an incognito/private window and sign in with the same email and
    password.
3. Sign out in the original window and confirm its cookie disappears and server
    status becomes `{ registered: false }`.
4. Return focus to the original window and confirm the cookie is not recreated.
5. Confirm the private window remains signed in.
6. In the original window, try an incorrect password and confirm an error
    appears without signing you in.
7. Try the correct password and confirm sign-in succeeds.

A private window has its own browser storage, so you can use it to represent a
second device for this check.

### Reset a password

You should complete the emulator password-reset action and verify both
passwords:

1. Sign out, enter the synthetic account's email, and click **Reset password**.
2. Confirm the generic reset-email confirmation appears.
3. In the log terminal, find **To reset the password** for that address and copy
    its complete URL.
4. Replace `NEW_PASSWORD_HERE` in the URL with a new test password, such as
    `another-test-password`.
5. Open the edited URL in a new tab and confirm the emulator reports success.
6. Return to the account page and confirm sign-in succeeds with the new
    password.
7. Sign out again, try the old password, and confirm sign-in fails.

The emulator accepts the new password in the URL rather than displaying the
hosted Firebase password-reset form. The example password uses URL-safe
characters; passwords containing special URL characters must be URL-encoded.

The log-based verification and reset behavior is documented in
[Firebase's Auth emulator guide](https://firebase.google.com/docs/emulator-suite/connect_auth#email_and_password_authentication).

### Google sign-in and keyboard access

You should verify the emulator Google flow, keyboard access, and narrow-screen
layout:

1. Sign out and click **Continue with Google**.
2. In the emulator popup, choose **Add new account** and enter a synthetic
    email.
3. Complete sign-in and confirm that email appears on the account page.
4. Sign out and use Tab/Shift+Tab and Enter to navigate and submit the form.
5. Confirm controls are usable and keyboard focus is visible.
6. Repeat the keyboard checks at a narrow viewport.

This checks the local Google emulator flow. A real Google provider still needs a
separate check in a configured non-production Firebase project.

### Optional: automated regression checks during a session

You can run the automated server and browser checks during the same session:

1. Keep the Auth emulator running on port 9099.
2. Build the production app from the repository root:

    ```sh
    pnpm build
    ```

3. Run the server and browser authentication tests:

    ```sh
    pnpm test:auth
    ```

4. Confirm both tests pass.
5. Run the other applicable checks in the
    [everyday checks section](#everyday-checks).

The tests start temporary web servers on free ports, create synthetic accounts,
and stop their servers when finished. Playwright's clock advances the renewal
and retry timers. The tests set up demo credentials automatically. You do not
need shell variable assignments, and the tests do not read credentials from your
`.env`.

### Finish authentication testing

You should close test sessions and stop services you started:

1. Sign out of test accounts and close private windows.
2. Press Ctrl+C in terminals running Nuxt, emulator log viewers, or Storybook if
    you started it.
3. Stop this checkout's background services:

    ```sh
    pnpm dev:stop
    ```

4. Confirm no services remain running for the checkout:

    ```sh
    pnpm dev:status
    ```

Leaving a log viewer does not stop the emulator. You should enter `Y` and press
Enter if Windows asks “Terminate batch job (Y/N)?”

Database and dependency volumes and downloaded emulator artifacts are preserved.
Auth accounts are in memory and disappear when the emulator stops. You should
register fresh synthetic accounts next session.
