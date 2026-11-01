# Manually test authentication

This document is for developers and testers, including beginners, who want to
check that sign-in, email verification, password reset and sign-out work locally.
It explains how to use fake accounts, find test email links, and recognize
successful results.

The Firebase Auth emulator is a local substitute for Firebase's sign-in service;
it uses synthetic accounts and sends no real emails. Run terminal commands from
the repository root in PowerShell or Bash.

## One-time setup for each checkout

This section is for those who want to prepare the local app and browser before
testing authentication for the first time.

1. Complete [local development setup](development.md#one-time-setup-for-each-checkout), including dependencies and the root `.env` file.
2. Keep the example's local demo settings, which need no hosted Firebase project or real credentials.
3. Choose a Chromium browser, such as Chrome or Edge, for the developer-tools checks below.
4. If you will run the automated browser test, install Playwright's separate Chromium browser:

   ```text
   pnpm --filter @idea-map/web exec playwright install chromium
   ```

## Start of each work session

This section is for those who want to start the app, watch emulator messages,
and prepare the browser to inspect test results.

1. Follow the [development session-start steps](development.md#start-of-each-work-session) to start and check services and run `pnpm dev`.
2. Open <http://127.0.0.1:3000/account>, keeping this exact origin throughout the tests.
3. Watch Firebase logs in another terminal at the repository root:

   ```text
   pnpm dev:logs firebase
   ```

4. Open the browser's developer tools with F12.
5. In **Network**, enable **Preserve log** and filter for `session`.
6. In **Console**, run this whenever a test asks you to check server status:

   ```javascript
   await (await fetch('/api/session')).json()
   ```

Before signing in, server status should be `{ registered: false }`.

When the app requests verification or a password reset, the log terminal prints
the account's email address and an action URL. Open that URL to simulate the
email action; there is no real email or emulator dashboard in this setup.

## Register and verify in the original tab

This section is for those who want to check account creation and confirm that
email verification takes effect immediately in the original browser tab.

1. Enter a unique synthetic email, such as `manual-account@example.test`, and a test password of at least six characters.
2. Click **Create account**.
3. Confirm the signed-in message and verification-email confirmation appear, then check server status against the table below.
4. In the log terminal, find **To verify the email address** for the email you registered.
5. Copy the complete URL after **follow this link** and open it in a new browser tab.
6. Confirm the emulator reports successful verification.
7. Within four minutes of registration, reload the **original account tab** and wait for a successful `POST /api/session`.
8. Check server status and confirm it reports a verified email without signing in again.
9. In **Application > Cookies**, inspect the site's `__session` cookie against the expected flags below.

| Checkpoint | Expected result |
| --- | --- |
| After registration | “Signed in as …” and “Check your email for a verification link.” |
| Server status before verification | `{ registered: true, emailVerified: false }` |
| Verification URL | Starts with `http://127.0.0.1:9099/emulator/action?mode=verifyEmail` and includes the emulator-generated action code. |
| Server status after verification and immediate reload | `{ registered: true, emailVerified: true }` |
| Session cookie | HttpOnly, Secure, SameSite=Lax and an expiry about 14 days away. |

The immediate reload checks for cached pre-verification claims. If you need a
new link, click **Send verification email** and repeat steps 4–6 using the
newest log entry for that address.

## Renew and recover an open session

This section is for those who want to check that an open tab renews its session
and recovers automatically after a temporary connection failure.

1. Keep the signed-in tab open for 50 minutes without reloading.
2. Confirm a successful `POST /api/session`, a new `Set-Cookie` response, and a later cookie expiry while remaining signed in.
3. Switch to another application and back, then confirm another successful session POST.
4. In DevTools **Network**, select **Offline**, then switch away and back.
5. Confirm the refresh error below appears while the signed-in identity remains visible.
6. Stay offline for at least one minute and confirm another failed refresh attempt.
7. Select **No throttling** and wait for the browser's online event or the next one-minute retry.
8. Confirm a successful session POST and that the refresh error clears.

The expected error is:

> Your server session could not be refreshed. Retrying automatically, or sign out.

Browser background throttling can delay timers. Steps 1–2 test scheduled renewal,
while step 3 tests focus recovery without waiting 50 minutes.

## Check persistence and device-specific logout

This section is for those who want to check that reloading preserves sign-in
and signing out affects only the current browser's session.

1. Reload while signed in and confirm the identity and registered server status persist.
2. Open an incognito/private window and sign in with the same email and password.
3. Sign out in the original window and confirm its cookie disappears and server status becomes `{ registered: false }`.
4. Return focus to the original window and confirm the cookie is not recreated.
5. Confirm the private window remains signed in.
6. In the original window, try an incorrect password and confirm an error appears without signing you in.
7. Try the correct password and confirm sign-in succeeds.

The private window has separate browser storage, so it represents a second
device for this check.

## Reset a password

This section is for those who want to check the reset request, complete the
emulator's password-reset action, and sign in with the new password.

1. Sign out, enter the synthetic account's email, and click **Reset password**.
2. Confirm the generic reset-email confirmation appears.
3. In the log terminal, find **To reset the password** for that address and copy its complete URL.
4. Replace `NEW_PASSWORD_HERE` in the URL with a new test password, such as `another-test-password`.
5. Open the edited URL in a new tab and confirm the emulator reports success.
6. Return to the account page and confirm sign-in succeeds with the new password.
7. Sign out again, try the old password, and confirm sign-in fails.

The emulator accepts the new password in the URL rather than displaying the
hosted Firebase password-reset form. The example password uses URL-safe
characters; passwords containing special URL characters must be URL-encoded.

The log-based verification and reset behavior is documented in
[Firebase's Auth emulator guide](https://firebase.google.com/docs/emulator-suite/connect_auth#email_and_password_authentication).

## Google sign-in and keyboard access

This section is for those who want to check the local Google sign-in flow and
confirm that the account form works with a keyboard and a narrow screen.

1. Sign out and click **Continue with Google**.
2. In the emulator popup, choose **Add new account** and enter a synthetic email.
3. Complete sign-in and confirm that email appears on the account page.
4. Sign out and use Tab/Shift+Tab and Enter to navigate and submit the form.
5. Confirm controls are usable and keyboard focus is visible.
6. Repeat the keyboard checks at a narrow viewport.

This checks the local Google emulator flow. A real Google provider still needs a
separate check in a configured non-production Firebase project.

## Optional automated regression checks during a session

This section is for those who want to run repeatable authentication checks
without waiting 50 real minutes for session renewal.

1. Keep the Auth emulator running on port 9099.
2. Build the production app from the repository root:

   ```text
   pnpm build
   ```

3. Run the server and browser authentication tests:

   ```text
   pnpm test:auth
   ```

4. Confirm both tests pass.
5. Run the remaining applicable checks in the [testing guide](testing.md).

The tests start temporary web servers on free ports, create synthetic accounts,
and stop their servers when finished. Playwright's clock advances the renewal
and retry timers. The tests configure demo credentials automatically and do not
require shell variable assignments or read your `.env` for credentials.

## End of each work session

This section is for those who want to close test sessions, stop services, and
free their ports after authentication testing.

1. Sign out of test accounts and close private windows.
2. Press Ctrl+C in terminals running Nuxt, emulator log viewers, or Storybook if you started it.
3. Stop this checkout's background services:

   ```text
   pnpm dev:stop
   ```

4. Confirm no services remain running for the checkout:

   ```text
   pnpm dev:status
   ```

Leaving a log viewer does not stop the emulator. If Windows asks
“Terminate batch job (Y/N)?”, enter `Y` and press Enter.

Database and dependency volumes and downloaded emulator artifacts are preserved.
Auth accounts are in memory and disappear when the emulator stops; register
fresh synthetic accounts next session.
