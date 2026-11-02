# Test the moderator review screen locally

Use this procedure for the synthetic moderator path prepared for issue #17. It
runs a real local browser, web server, Firebase Auth emulator, and disposable
PostGIS database. It does not enable live review or test automatic publication.
The screen can place and release holds, request and resolve changes, and assign
and transfer escalations. It does not offer approval or rejection while private
media review is unavailable.

1. Follow the [development setup](../contributor-guides/development-guide.md)
   and start this checkout's services with `pnpm dev:services`. Run
   `pnpm dev:status` and `pnpm dev:check`. Verify that `127.0.0.1:54329` and
   `127.0.0.1:9099` are the local disposable services, not tunnels to another
   environment. Identify this checkout's PostGIS container in `docker ps`.
2. Set `IDEA_MAP_REVIEW_TEST_CONTAINER` to that exact local container name and
   create a new database. If the name already exists, stop and choose a different
   `idea_map_test_` name; do not reuse or reset an existing database.

   ```sh
   docker exec "$IDEA_MAP_REVIEW_TEST_CONTAINER" createdb -U idea_map idea_map_test_review_screen
   DATABASE_URL=postgres://idea_map:local-only@127.0.0.1:54329/idea_map_test_review_screen pnpm --filter @idea-map/server db:migrate
   pnpm build
   CHROME_PATH=/usr/bin/chromium TEST_DATABASE_URL=postgres://idea_map:local-only@127.0.0.1:54329/idea_map_test_review_screen pnpm test:moderation-ui-integration
   ```

   Set `CHROME_PATH` to the local Chromium or Chrome executable if it differs.
   The test creates a synthetic emulator user and a scoped database role, then
   removes those test identities. It starts and stops its own web server and
   browser. A passing test exercises hold and change-request actions, escalation
   handoff, and role revocation; it does not validate cloud permissions, media access, caching,
   scoring, or production readiness.
3. When finished, verify that the named database is the disposable database you
   created for this test and that no other process is using it. Remove only that
   database with `docker exec "$IDEA_MAP_REVIEW_TEST_CONTAINER" dropdb -U idea_map idea_map_test_review_screen`.
   If you started the checkout's services for this test, stop them with
   `pnpm dev:stop` and verify with `pnpm dev:status`.
