# Test the moderator review screen locally

Use this procedure for the synthetic moderator path prepared for issue #17. It
runs a real local browser, web server, Firebase Auth emulator, and disposable
PostGIS database. It does not enable live review or test automatic publication.
The screen can place and release holds and request and resolve changes; it does
not offer approval or rejection while private media review is unavailable.

The following contents links navigate within this guide:

- [When to use this guide](#when-to-use-this-guide)
- [Prepare your checkout](#prepare-your-checkout)
- [Run the test](#run-the-test)
    - [Bash](#bash)
    - [PowerShell](#powershell)
- [Clean up the test session](#clean-up-the-test-session)

## When to use this guide

You can use these situations to decide whether this local test covers your change.

| When this happens... | Use this guide to... |
| --- | --- |
| You change moderator holds or change requests. | Verify that a browser can record and resolve those actions through local authentication and database services while the idea stays private. |
| You change moderator access checks. | Verify that revoking a moderator role clears displayed review content. |
| You need reproducible reviewer-screen evidence. | Run the synthetic integration test with a fresh disposable database and clean up its services. |

## Prepare your checkout

You should complete the [development setup](../contributor-guides/development-guide.md)
once for this checkout before starting services. You also need a local Chromium
or Chrome executable; use its actual path in the test commands below.

At the start of each test session, you should complete these steps from the
repository root:

1. Start this checkout's services with `pnpm dev:services`.
2. Check service readiness with `pnpm dev:status` and `pnpm dev:check`.
3. Verify that `127.0.0.1:54329` and `127.0.0.1:9099` are this checkout's local disposable services, not tunnels to another environment.
4. Identify this checkout's PostGIS container in `docker ps`.

## Run the test

You should choose the commands for your shell below and run them from the
repository root. Replace `your-postgis-container` with the exact container name
identified above and replace the browser path if it differs on your machine.

The examples create `idea_map_test_review_screen`. If that database already
exists, you must stop and choose a different name beginning with `idea_map_test_`
in every command below and in the cleanup command; do not reuse or reset an
existing database. A failed command means you should stop and investigate before
continuing to the next step.

The test creates a synthetic emulator user and a scoped database role, then
removes those test identities. It starts and stops its own web server and
browser. A passing test exercises hold and change-request actions and role
revocation; it does not validate cloud permissions, media access, caching,
scoring, or production readiness.

### Bash

You should run these steps in Bash:

1. Save the container name and create the disposable database.

    ```bash
    IDEA_MAP_REVIEW_TEST_CONTAINER='your-postgis-container'
    docker exec "$IDEA_MAP_REVIEW_TEST_CONTAINER" createdb -U idea_map idea_map_test_review_screen
    ```

2. Apply migrations to the new database.

    ```bash
    DATABASE_URL=postgres://idea_map:local-only@127.0.0.1:54329/idea_map_test_review_screen pnpm --filter @idea-map/server db:migrate
    ```

3. Build the application.

    ```bash
    pnpm build
    ```

4. Run the browser integration test against the disposable database.

    ```bash
    CHROME_PATH=/usr/bin/chromium TEST_DATABASE_URL=postgres://idea_map:local-only@127.0.0.1:54329/idea_map_test_review_screen pnpm test:moderation-ui-integration
    ```

### PowerShell

You should run these steps in PowerShell. The `try`/`finally` blocks restore
any previous environment settings after each command, including after failure.

1. Save the container name and create the disposable database.

    ```powershell
    $IDEA_MAP_REVIEW_TEST_CONTAINER = 'your-postgis-container'
    docker exec "$IDEA_MAP_REVIEW_TEST_CONTAINER" createdb -U idea_map idea_map_test_review_screen
    ```

2. Apply migrations to the new database.

    ```powershell
    $previousDatabaseUrl = $env:DATABASE_URL
    try {
        $env:DATABASE_URL = 'postgres://idea_map:local-only@127.0.0.1:54329/idea_map_test_review_screen'
        pnpm --filter @idea-map/server db:migrate
        if ($LASTEXITCODE -ne 0) { throw 'Migration failed; stop before continuing.' }
    } finally {
        $env:DATABASE_URL = $previousDatabaseUrl
    }
    ```

3. Build the application.

    ```powershell
    pnpm build
    ```

4. Run the browser integration test against the disposable database.

    ```powershell
    $previousChromePath = $env:CHROME_PATH
    $previousTestDatabaseUrl = $env:TEST_DATABASE_URL
    try {
        $env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
        $env:TEST_DATABASE_URL = 'postgres://idea_map:local-only@127.0.0.1:54329/idea_map_test_review_screen'
        pnpm test:moderation-ui-integration
        if ($LASTEXITCODE -ne 0) { throw 'Integration test failed.' }
    } finally {
        $env:CHROME_PATH = $previousChromePath
        $env:TEST_DATABASE_URL = $previousTestDatabaseUrl
    }
    ```

## Clean up the test session

The test leaves its disposable database in place. You should use the same shell
session and container variable from the test to complete these steps, whether
the test passed or failed:

1. Verify that the database named below is the disposable database you created for this test and that no other process is using it.
2. Remove only that database with the following command, which works in both Bash and PowerShell.

    ```sh
    docker exec "$IDEA_MAP_REVIEW_TEST_CONTAINER" dropdb -U idea_map idea_map_test_review_screen
    ```

3. If you started this checkout's services for the test, stop them with `pnpm dev:stop`.
4. Confirm that those services stopped with `pnpm dev:status`.

Deleting the disposable database removes its test records. Other databases and
services that were already running before this session should remain intact.
