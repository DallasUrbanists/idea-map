# Firebase architecture

When you work on sign-in or live updates, you need to know what Firebase
handles and what stays in the app's database. Here you'll find how accounts,
sessions, emulators, and live updates fit together. The
[API policy](../policies/api-policy.md#sessions) covers session security, and
the [testing guide](../contributor-guides/testing-guide.md#authentication-testing)
has the authentication checks.

The following contents links navigate within this guide:

- [Identity and sessions](#identity-and-sessions)
- [Local emulators](#local-emulators)
- [Real-time projections](#real-time-projections)

## Identity and sessions

The browser Firebase software development kit (SDK) provides email/password and
Google sign-in, email verification, password reset, and identity-token refresh.
The server Admin SDK verifies tokens and revocation before creating session
cookies. Public Firebase identifiers are browser configuration; Admin
credentials remain server-only.

The browser renews the server session after refreshing claims, when the tab
regains focus, when the connection returns, and every 50 minutes. If renewal
fails, it retries after one minute. Signing out clears the session in that
browser and leaves other devices signed in. Verified identity and resource
authorization remain separate checks.

Hosted environments use their own project identifiers, provider configuration,
authorized origins, and OAuth redirects. The server must use Application Default
Credentials rather than checked-in service-account keys. The browser bundle must
not contain server credentials.

## Local emulators

The [emulator configuration](../../dev/firebase.json) uses project
`demo-idea-map`, Auth port 9099, and Firestore port 8080. Firestore rules are
deny-by-default, and the emulator dashboard is disabled. You can find
email-verification and password-reset links in the Firebase logs. The emulator
does not send real email.

The tools container uses `firebase:9099` for server Auth calls; the browser uses
`http://127.0.0.1:9099`. Emulator settings must be absent in hosted
environments. The local emulator loses account and document records on shutdown.

## Real-time projections

PostgreSQL holds the authoritative records. Firestore stores narrowly scoped
views of the data, called projections, for real-time updates. Projection writers
must enforce privacy and approval boundaries, and must remove public projections
when content is withdrawn, replaced, or removed.

Listeners generate reads on initial delivery, changes, and reconnection. When
you set workload limits or test reconnection, you should include listener
fan-out and index reads. Monthly averages do not show daily peaks.
