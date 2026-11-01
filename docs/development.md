# Local development

This document is for developers, including beginners, who want to run Idea Map
on their own computer. It explains first-time setup, starting and stopping a
work session, local services, and authentication settings.

Run commands from the repository root: the folder containing
`pnpm-workspace.yaml`. The commands work in PowerShell and Bash and use local,
synthetic data without hosted Firebase credentials.

## One-time setup for each checkout

This section is for those who want to prepare a local copy of the project
before running it for the first time.

1. Install Node 24.22.1, pnpm 11.25.0 and Docker Desktop with its Linux engine, or a compatible Linux Docker Engine with Compose.
2. Verify the installed versions:

   ```text
   node --version
   pnpm --version
   docker compose version
   ```

3. Install the locked project dependencies:

   ```text
   pnpm install --frozen-lockfile
   ```

4. If `.env` does not exist, use your editor to duplicate [`.env.example`](../.env.example) at the repository root and name the copy `.env`, not `.env.txt`.
5. If `.env` already exists, compare it with the example and add missing settings without replacing your existing configuration.

| Setup detail | What to expect |
| --- | --- |
| Node version | `node --version` reports `v24.22.1`. |
| pnpm version | `pnpm --version` reports `11.25.0`. |
| Docker Compose | `docker compose version` reports an installed Compose version. |
| Local configuration | The example contains demo Firebase identifiers and a local database address; keep those values for this workflow. |
| Configuration loading | `pnpm dev` loads the root `.env` into Nuxt, including its server-side emulator setting; `pnpm dev:db:migrate` loads it for the database CLI. |
| Configuration privacy | Git ignores `.env`; keep personal secrets out of the tracked `.env.example`. |

Repeat dependency installation after pulling changes to `pnpm-lock.yaml`.
Continue with the session-start steps once setup is complete.

## Start of each work session

This section is for those who want to start the local services and open the app
for a development session.

1. Start Docker Desktop, wait for its Linux engine to be ready, and open a terminal at the repository root.
2. Start this checkout's database and Firebase emulators in the background:

   ```text
   pnpm dev:services
   ```

3. Check which services are running:

   ```text
   pnpm dev:status
   ```

4. Check database and emulator readiness:

   ```text
   pnpm dev:check
   ```

5. Apply database migrations:

   ```text
   pnpm dev:db:migrate
   ```

6. Start the web app and leave its terminal open:

   ```text
   pnpm dev
   ```

7. Open <http://127.0.0.1:3000>, using that exact address to match `NUXT_SESSION_ORIGIN` in `.env`.
8. If you need Storybook, open another terminal at the repository root and run:

   ```text
   pnpm dev:storybook
   ```

9. Open <http://localhost:6006> if you started Storybook.
10. To watch emulator messages, open another terminal at the repository root and run:

    ```text
    pnpm dev:logs firebase
    ```

| Command | Successful result |
| --- | --- |
| `pnpm dev:services` | Services start under a Compose project name derived automatically from this checkout's path. |
| `pnpm dev:check` | A PostGIS version and successful Auth and Firestore HTTP checks appear. |
| `pnpm dev:db:migrate` | Migrations finish successfully; repeating the command skips migrations already applied. |
| `pnpm dev` | Shared TypeScript packages build and Nuxt starts at `http://127.0.0.1:3000`. |
| `pnpm dev:storybook` | Storybook opens on port 6006; its welcome story checks connectivity while the component catalog is being built. |
| `pnpm dev:logs firebase` | Emulator logs appear, including email verification and password-reset links when requested by the app. |

The first startup can take several minutes to build images and download emulator
artifacts. A newly migrated database contains no ideas because migrations do not
populate example content. The [manual authentication guide](auth-manual-testing.md)
explains how to test sign-in and use the email action links.

## End of each work session

This section is for those who want to stop local services and free their ports
before finishing work.

1. Press Ctrl+C in each terminal running Nuxt, Storybook or a log viewer.
2. Stop this checkout's background services:

   ```text
   pnpm dev:stop
   ```

3. Confirm the checkout's containers have stopped:

   ```text
   pnpm dev:status
   ```

Closing a log viewer does not stop its services. If Windows asks
“Terminate batch job (Y/N)?”, enter `Y` and press Enter.

| Resource | What shutdown does |
| --- | --- |
| Native Nuxt and Storybook processes | Ctrl+C stops each process and releases its port. |
| This checkout's Compose containers | `pnpm dev:stop` stops them and releases their published ports; `pnpm dev:status` should show no running services for this project. |
| PostgreSQL data and dependency volumes | Preserved for the next session. |
| Downloaded emulator artifacts | Preserved in the cache volume. |
| Auth accounts and Firestore emulator records | Lost because they are in memory; create fresh synthetic accounts next session. |
| Other checkouts' services | Unaffected by this checkout's stop command. |

## Run the app in Docker instead

This section is for those who want to run the app and its component preview
inside Docker.

The tools container runs Nuxt (the app) and Storybook (the component preview).
Node and pnpm are still needed on the host to run the package commands.
Choose either this workflow or native `pnpm dev`; they use the same web ports.

### One-time setup

This section is for those who want to prepare the Docker app workflow and
understand how its configuration differs from native development.

1. Complete the [one-time setup above](#one-time-setup-for-each-checkout), including creating the root `.env`.
2. Keep the example's local settings and review the automatic container overrides below.

| Setting | Inside the tools container |
| --- | --- |
| Root `.env` | Compose passes its values to the container. |
| Database addresses | Compose uses the `db` service instead of the host's loopback address. |
| Server-side Auth emulator | Compose uses `firebase:9099`. |
| Browser Auth emulator | The public URL stays `http://127.0.0.1:9099` because the browser runs on your computer. |

### Start of each work session

This section is for those who want to start the Docker app workflow and check
that its services are ready.

1. Start Docker Desktop and open a terminal at the repository root.
2. Start services and the app container:

   ```text
   pnpm dev:all
   ```

3. Check container status:

   ```text
   pnpm dev:status
   ```

4. Watch app startup in another terminal:

   ```text
   pnpm dev:logs tools
   ```

5. Wait for dependency installation and both app servers to finish starting, then press Ctrl+C to leave the log viewer.
6. Check database and emulator readiness:

   ```text
   pnpm dev:check
   ```

7. Apply database migrations inside the tools container:

   ```text
   pnpm dev:db:migrate:container
   ```

8. Open <http://127.0.0.1:3000> and <http://localhost:6006>.

Polling watches mounted source files in this workflow, which can use more CPU
and be slower than native development.

### End of each work session

This section is for those who want to stop the Docker app workflow and release
the ports used by its containers.

1. Press Ctrl+C in log-viewer terminals.
2. Run `pnpm dev:stop` to stop services, including the tools container.
3. Run `pnpm dev:status` to confirm no services remain running for this checkout.

The [shutdown resource table above](#end-of-each-work-session) explains which
data is preserved and which emulator records are lost.

## Ports and troubleshooting

This section is for those who want to find a local service's address or diagnose
a startup or sign-in problem.

| Service | Local address |
| --- | --- |
| Nuxt | `http://127.0.0.1:3000` |
| Storybook | `http://localhost:6006` |
| PostgreSQL/PostGIS | `127.0.0.1:54329` |
| Firebase Auth emulator | `http://127.0.0.1:9099` |
| Firestore emulator | `http://127.0.0.1:8080` |

All published service ports bind loopback only. The emulator project is
`demo-idea-map`, with deny-by-default Firestore rules. The emulator dashboard is
disabled; email action links appear in `pnpm dev:logs firebase`.

1. If startup fails, confirm Docker's Linux engine is running and inspect `pnpm dev:status` and `pnpm dev:logs`.
2. If downloads are still in progress, wait for the emulators to report ready in their logs and retry `pnpm dev:check`.
3. If a port is occupied, stop the previous session you own from its checkout using the [shutdown steps](#end-of-each-work-session).
4. If sign-in fails, compare the root `.env` with the example and confirm the browser address is exactly `http://127.0.0.1:3000`.
5. After changing configuration, restart `pnpm dev` and run `pnpm dev:check` to check service connectivity.

Project names are isolated, but published ports are fixed, so two checkouts
cannot run these services simultaneously. The readiness command checks
connectivity rather than migrations, application authentication or Firestore
rules. Auth is connected to the emulator; complete browse/submit/jobs flows and
other fixtures remain under development.

## Authentication outside the emulator

This section is for those who want to understand what changes when authentication
uses a hosted Firebase project instead of the local emulator.

The local demo settings are not hosted deployment settings. A hosted environment
has the following requirements.

| Area | Hosted environment requirement |
| --- | --- |
| Session origin | `NUXT_SESSION_ORIGIN` matches the exact public origin. |
| Firebase identifiers | Server `NUXT_FIREBASE_PROJECT_ID` and public Firebase identifiers refer to the intended project. |
| Server credentials | Application Default Credentials supply server access; service-account keys never belong in browser configuration or source control. |
| Public configuration | Browser settings contain public identifiers only. |
| Sign-in providers | Email/password and Google providers are enabled in the intended Firebase project. |
| Emulator settings | Emulator connection settings are absent. |

The account page maintains a private, HttpOnly `__session` cookie. Session creation
verifies token signatures and revocation and requires a recently minted ID token.
The browser refreshes claims and renews the cookie every 50 minutes, on focus and
on reconnect, retrying failures after one minute.

Session mutations require the configured exact Origin and a non-simple JSON
header, with cross-origin CORS disabled for this endpoint. Logout clears this
browser's session without revoking other devices. Future protected routes must
verify cookies with revocation checks and enforce their own authorization,
including verified-email requirements. The cookie alone grants no access to
private data.
