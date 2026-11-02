# Development guide

You can run Idea Map on your own computer using local services and synthetic
data, with no production credentials. This guide walks you through setting up
your first checkout, starting the app, and stopping services when you're done.
It also helps you find configuration settings and troubleshoot problems along
the way.

Contributors should run commands from the repository root: the folder containing
`pnpm-workspace.yaml`. The commands work in PowerShell and Bash and use local,
synthetic data without hosted Firebase credentials.

The following contents links navigate within this guide:

- [One-time setup for each checkout](#one-time-setup-for-each-checkout)
- [Start of each work session](#start-of-each-work-session)
- [End of each work session](#end-of-each-work-session)
- [Run the app in Docker instead](#run-the-app-in-docker-instead)
    - [One-time setup](#one-time-setup)
    - [Start of each work session](#start-of-each-work-session-1)
    - [End of each work session](#end-of-each-work-session-1)
- [Ports and troubleshooting](#ports-and-troubleshooting)
- [Authentication outside the emulator](#authentication-outside-the-emulator)
- [Document user-facing changes](#document-user-facing-changes)
- [Prepare and review a pull request](#prepare-and-review-a-pull-request)

## One-time setup for each checkout

You should prepare each checkout with these steps:

1. Install Node.js 24.22.1, pnpm 11.25.0, and Docker Desktop with its Linux
    engine, or a compatible Linux Docker Engine with Compose.
2. Verify the installed versions:

    ```sh
    node --version
    pnpm --version
    docker compose version
    ```

3. Install the locked project dependencies:

    ```sh
    pnpm install --frozen-lockfile
    ```

4. If `.env` does not exist, use your editor to duplicate
    [`.env.example`](../../.env.example) at the repository root and name the
    copy `.env`, not `.env.txt`.
5. If `.env` already exists, compare it with the example and add missing
    settings without replacing your existing configuration.

You can use these checks to confirm that setup and configuration are correct:

| Setup detail | What to expect |
| --- | --- |
| Node.js version | `node --version` reports `v24.22.1`. |
| pnpm version | `pnpm --version` reports `11.25.0`. |
| Docker Compose | `docker compose version` reports an installed Compose version. |
| Local configuration | The example contains demo Firebase identifiers and a local database address; keep those values for this workflow. |
| Configuration loading | `pnpm dev` loads the root `.env` into Nuxt, including its server-side emulator setting; `pnpm dev:db:migrate` loads it for the database *command-line interface (CLI)*. |
| Configuration privacy | Git ignores `.env`; keep personal secrets out of the tracked `.env.example`. |

You should repeat dependency installation after pulling changes to
`pnpm-lock.yaml`. Continue with the session-start steps once setup is complete.

## Start of each work session

You should start each native development session with these steps:

1. Start Docker Desktop, wait for its Linux engine to be ready, and open a
    terminal at the repository root.
2. Start this checkout's database and Firebase emulators in the background:

    ```sh
    pnpm dev:services
    ```

3. Check which services are running:

    ```sh
    pnpm dev:status
    ```

4. Check database and emulator readiness:

    ```sh
    pnpm dev:check
    ```

5. Apply database migrations:

    ```sh
    pnpm dev:db:migrate
    ```

6. Start the web app and leave its terminal open:

    ```sh
    pnpm dev
    ```

7. Open the [local application](http://127.0.0.1:3000), using that exact address
    to match `NUXT_SESSION_ORIGIN` in `.env`.
8. Optional: To preview components in Storybook, open another terminal at the
    repository root and run:

    ```sh
    pnpm dev:storybook
    ```

9. Optional: Open [Storybook](http://localhost:6006) if you started it.
10. Optional: To watch emulator messages, open another terminal at the
    repository root and run:

    ```sh
    pnpm dev:logs firebase
    ```

These results show that the services and commands are ready for your session:

| Command | Successful result |
| --- | --- |
| `pnpm dev:services` | Services start under a Compose project name derived automatically from this checkout's path. |
| `pnpm dev:check` | A PostGIS version and successful Auth and Firestore HTTP checks appear. |
| `pnpm dev:db:migrate` | Migrations finish successfully; repeating the command skips migrations already applied. |
| `pnpm dev` | Shared TypeScript packages build and Nuxt starts at `http://127.0.0.1:3000`. |
| `pnpm dev:storybook` | Storybook opens on port 6006; its stories document component behavior and states. |
| `pnpm dev:logs firebase` | Emulator logs appear, including email verification and password-reset links when requested by the app. |

The first startup can take several minutes while Docker builds images and
downloads emulator files. A newly migrated database contains no ideas because
migrations do not populate example content. The
[manual authentication guide](testing-guide.md#authentication-testing) explains
how to test sign-in and use the email action links.

## End of each work session

You should stop services and free their ports at the end of a session:

1. Press Ctrl+C in each terminal running Nuxt, Storybook, or a log viewer.
2. Stop this checkout's background services:

    ```sh
    pnpm dev:stop
    ```

3. Confirm the checkout's containers have stopped:

    ```sh
    pnpm dev:status
    ```

Closing a log viewer does not stop its services. You should enter `Y` and press
Enter if Windows asks “Terminate batch job (Y/N)?”

This table shows what stops and what data stays available for your next session:

| Resource | What shutdown does |
| --- | --- |
| Native Nuxt and Storybook processes | Ctrl+C stops each process and releases its port. |
| This checkout's Compose containers | `pnpm dev:stop` stops them and releases their published ports; `pnpm dev:status` shows no running services for this project. |
| PostgreSQL data and dependency volumes | Preserved for the next session. |
| Downloaded emulator artifacts | Preserved in the cache volume. |
| Auth accounts and Firestore emulator records | Lost because they are in memory; create fresh synthetic accounts next session. |
| Other checkouts' services | Unaffected by this checkout's stop command. |

## Run the app in Docker instead

The tools-container workflow runs the application and component preview in
Docker.

The tools container runs Nuxt (the app) and Storybook (the component preview).
Node.js and pnpm are needed on the host to run the package commands. You should
choose either this workflow or native `pnpm dev`; they use the same web ports.

### One-time setup

You should prepare the tools-container workflow with these steps:

1. Complete the [checkout setup](#one-time-setup-for-each-checkout), including
    creating the root `.env`.
2. Keep the example's local settings and review the following container
    overrides.

The tools container applies these settings to distinguish server and browser
connections:

| Setting | Inside the tools container |
| --- | --- |
| Root `.env` | Compose passes its values to the container. |
| Database addresses | Compose uses the `db` service instead of the host's loopback address. |
| Server-side Auth emulator | Compose uses `firebase:9099`. |
| Browser Auth emulator | The public URL stays `http://127.0.0.1:9099` because the browser runs on your computer. |

### Start of each work session

You should start and check the tools-container workflow as follows:

1. Start Docker Desktop and open a terminal at the repository root.
2. Start services and the app container:

    ```sh
    pnpm dev:all
    ```

3. Check container status:

    ```sh
    pnpm dev:status
    ```

4. Watch app startup in another terminal:

    ```sh
    pnpm dev:logs tools
    ```

5. Wait for dependency installation and both app servers to finish starting,
    then press Ctrl+C to leave the log viewer.
6. Check database and emulator readiness:

    ```sh
    pnpm dev:check
    ```

7. Apply database migrations inside the tools container:

    ```sh
    pnpm dev:db:migrate:container
    ```

8. Open the [local application](http://127.0.0.1:3000) and
    [Storybook](http://localhost:6006).

Polling watches mounted source files in this workflow, which can use more
processor resources and be slower than native development.

### End of each work session

You should stop the tools-container workflow as follows:

1. Press Ctrl+C in log-viewer terminals.
2. Run `pnpm dev:stop` to stop services, including the tools container.
3. Run `pnpm dev:status` to confirm no services remain running for this
    checkout.

The [session shutdown section](#end-of-each-work-session) explains which data is
preserved and which emulator records are lost.

## Ports and troubleshooting

You can use these addresses when checking startup or sign-in:

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

You should diagnose startup and sign-in failures in this order:

1. If startup fails, confirm Docker's Linux engine is running and inspect
    `pnpm dev:status` and `pnpm dev:logs`.
2. If downloads are still in progress, wait for the emulators to report ready in
    their logs and retry `pnpm dev:check`.
3. If a port is occupied, stop the previous session you own from its checkout
    using the [shutdown steps](#end-of-each-work-session).
4. If sign-in fails, compare the root `.env` with the example and confirm the
    browser address is exactly `http://127.0.0.1:3000`.
5. After changing configuration, restart `pnpm dev` and run `pnpm dev:check` to
    check service connectivity.

Project names are isolated, but published ports are fixed, so two checkouts
cannot run these services simultaneously. The readiness command checks
connectivity rather than migrations, application authentication or Firestore
rules. Authentication connects to the emulator. Tests use synthetic fixtures and
isolated provider checks to exercise application flows.

## Authentication outside the emulator

Hosted authentication uses these settings instead of local emulator settings.

For a hosted environment, the settings need to meet these requirements:

| Area | Hosted environment requirement |
| --- | --- |
| Session origin | `NUXT_SESSION_ORIGIN` matches the exact public origin. |
| Firebase identifiers | Server `NUXT_FIREBASE_PROJECT_ID` and public Firebase identifiers refer to the intended project. |
| Server credentials | Application Default Credentials supply server access; service-account keys never belong in browser configuration or source control. |
| Public configuration | Browser settings contain public identifiers only. |
| Sign-in providers | Email/password and Google providers are enabled in the intended Firebase project. |
| Emulator settings | Emulator connection settings are absent. |

The [API policy](../policies/api-policy.md#sessions) defines cookie behavior,
token verification, renewal, origin checks, and per-route authorization.

## Document user-facing changes

When your change affects how someone uses Idea Map, you should add or update the
matching guide in `docs/user-guides/` in the same pull request. The
[user-guide writing rules](documentation-style-guide.md#user-guides) explain
when to create a new `how-to-` file, when to edit an existing guide, and how to
write and validate the steps for nontechnical readers.

You should keep those instructions focused on the user's task and the controls
they see. Developer setup and architecture belong in the contributor and
platform guides, and internal changes need no user guide unless the user
experience changes.

## Prepare and review a pull request

Before sharing your change, you should run the relevant checks from the
[testing guide](testing-guide.md) and prepare the description using
[CONTRIBUTING.md](../../CONTRIBUTING.md). The
[pull-request review guide](pull-request-review-guide.md) helps you check the
diff, behavior, documentation, and validation evidence before asking for review.

When you review someone else's change, you should follow that same guide to
check requirements, leave actionable feedback, and record what you verified.
Documentation checks apply to code changes as well as documentation-only work.
