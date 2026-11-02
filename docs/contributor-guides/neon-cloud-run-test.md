# Test Neon connectivity from Cloud Run

Operators can use a separate, authenticated Cloud Run service to check Idea
Map's pooled Neon connection and measure request latency with synthetic data.
The service does not replace the Cloud SQL-backed
[SSR staging service](ssr-staging.md). Its Terraform configuration is in
[`infra/neon-cloud-run-test`](../../infra/neon-cloud-run-test).

The following contents links navigate within this guide:

- [Resources and prerequisites](#resources-and-prerequisites)
- [Prepare the test service](#prepare-the-test-service)
- [Measure and finish](#measure-and-finish)

## Resources and prerequisites

The test service uses the existing `dallasurbanists-idea-map-dev` Google Cloud
project and `us-central1`. Its Cloud Run name and runtime service account are
`idea-map-neon-test`. Cloud Run enforces invoker authentication while accepting
network ingress, allowing an approved operator outside the project's network to
send authenticated requests. Project-level and inherited IAM grants may also
allow invocation; operators should review effective permissions before testing.

The service uses the existing web image with a separate pooled database secret,
zero minimum instances, a two-instance revision maximum, concurrency 20, and
shared HTML caching disabled. Its runtime identity receives access to the single
`idea-map-neon-test-url` secret, not the migration credential. The root grants
`roles/run.invoker` to one named user or service account. Cloud Run can briefly
exceed its configured maximum; operators must account for this in the
[connection budget](../architecture/neon.md#connection-budget).

The test service keeps CPU allocated for each instance's lifetime. Zero minimum
instances does not mean immediate scale-down; an instance can remain running
after a request finishes.

Operators need the pinned tools in the [development guide](development-guide.md),
Terraform 1.13 through 1.x, Google Cloud CLI credentials and Application Default
Credentials with access to the development project. Operators also need access
to the existing staging build identity, Artifact Registry and versioned
Terraform state bucket, plus permission to inspect and plan the isolated test
resources. Builds, secret creation, IAM grants, provisioning, deployment, and
load tests require explicit authorization and a reviewed target and test limits.

Use an empty, disposable Neon database named `idea_map_test_cloudrun`, separate
from the long-lived development database, with synthetic data only. Its
dedicated pooled runtime role needs the same column-level grants as the web
query and a separate credential from the long-lived development role. The
migration role needs a direct connection. Do not load the
[`ssr-fixture.sql`](../../packages/server/test/ssr-fixture.sql) fixture into the
long-lived database. The [database guide](../architecture/postgresql-postgis-drizzle.md#database-verification)
describes the test database boundary.

## Prepare the test service

An operator should prepare the following resources and review their intended
scope before deploying:

1. Migrate the disposable database through its direct connection and load the
    synthetic SSR fixture. Apply the
    [test runtime grants](../../packages/server/test/cloud-run-runtime-grants.sql)
    to that database; the script creates the runtime role with login disabled.
2. Set a separate password securely, then apply the
    [login-enabling script](../../packages/server/test/cloud-run-runtime-enable-login.sql)
    to the same database. Verify PostGIS and authenticate with the pooled role
    without printing connection strings or passwords.
3. Create the `idea-map-neon-test-url` secret in the development project and
    add a version containing only the pooled runtime connection to that test
    database. Keep the migration credential separate and note the numeric secret
    version; do not put secret values in Terraform variables or logs.
4. Build the reviewed application commit from a clean checkout as described in
    the [staging build procedure](ssr-staging.md#start-a-deployment), and record
    its immutable image digest. Inspect the upload list before building to
    ensure local credentials, environment files and Terraform state are excluded.
5. Create an ignored `infra/neon-cloud-run-test/test.tfvars` file with the
    reviewed, non-secret values shown below. Replace each uppercase placeholder
    with the actual value, including `user:EMAIL` or `serviceAccount:EMAIL` for
    the one approved invoker.

    ```hcl
    project_id              = "dallasurbanists-idea-map-dev"
    web_image               = "REGISTRY_IMAGE@sha256:IMAGE_DIGEST"
    database_secret_version = "SECRET_VERSION"
    invoker_member          = "user:EMAIL"
    ```

6. Initialize this root against the existing versioned staging state bucket
    with its own `staging/neon-test` prefix. Confirm that no other root owns the
    proposed service, runtime identity or IAM grants.

    ```sh
    terraform "-chdir=infra/neon-cloud-run-test" init "-backend-config=bucket=dallasurbanists-idea-map-dev-ssr-tfstate" "-backend-config=prefix=staging/neon-test"
    ```

7. Create and inspect a plan, including the exact service, secret access and
    invoker grant. Stop if it proposes changes to the existing SSR staging
    service, Cloud SQL, production, or unrelated resources.

    ```sh
    terraform "-chdir=infra/neon-cloud-run-test" plan "-var-file=test.tfvars" "-out=review.tfplan"
    terraform "-chdir=infra/neon-cloud-run-test" show review.tfplan
    ```

8. Apply only the reviewed plan after authorization, then confirm the service
    has the expected image, secret version, scale settings and effective invoker
    permissions. Keep state and plan files private because they can contain
    sensitive configuration.

The root does not create the database, fixture, secret or secret version. The
service is separate from Hosting and does not configure end-user authentication.
Neon requires a plaintext password when setting a SQL-created role's password;
its [role guide](https://neon.com/docs/manage/roles#manage-roles-with-sql)
describes the requirements. Use a secure session that does not record the
password in client history, SQL logs, query statistics, or command arguments.
The test role has no grants on the long-lived development tables, but PostgreSQL
`PUBLIC` privileges can still allow it to connect to other databases on the
same compute. The role's column grants permit reading test revision content
beyond approved rows; the application query enforces the publication filter.

To verify the grants without changing an existing role, use a separate local
PostGIS database named `idea_map_test_cloudrun`, apply the repository migrations,
and set `TEST_DATABASE_URL` to its direct connection on `127.0.0.1`. The test
connection needs permission to create roles and grant the query's table columns.
Then run this command from the repository root:

```sh
pnpm --filter @idea-map/server exec node --test test/cloud-run-runtime-grants.test.mjs
```

The tests create a cluster-wide role, exercise authentication and privileges,
and remove the role afterward. They fail if the role already exists, so use a
disposable PostgreSQL instance rather than the hosted development compute where
the test role is already present. Configure local password authentication to
check that an incorrect runtime password is rejected.

## Measure and finish

An authorized operator should invoke the Cloud Run URL as the approved
principal, using the [Cloud Run developer proxy](https://cloud.google.com/run/docs/authenticating/developers#use_the_cloud_run_proxy_in_the_gcloud_cli)
or another authenticated client without printing tokens. Request the approved,
private, unapproved and absent synthetic idea IDs from the fixture, and confirm
that only the approved idea is returned. The proxy adds a local network hop, so
record the measurement location and method.

Operators should follow the [isolated measurement procedure](../architecture/neon.md#verify-an-isolated-environment)
for confirmed cold and warm cycles, bounded load, connection counts and
capacity headroom. Record the service revision and image digest, database and
compute settings, sample counts, latency and errors. Compare with the direct
Cloud Run endpoint rather than Firebase Hosting's shared cache.

Before a combined cold request, confirm the Neon compute is suspended and use
Cloud Run instance metrics to check that both active and idle instance counts
are zero. Metrics are sampled and may be delayed; an absent sample alone does
not prove zero. After the request, check the instance startup log and Neon state
to corroborate the transition. Capture connection counts during the load test,
including retained pooler backends and a separate monitoring connection. A
revision overlap test must direct synthetic requests to each revision, stop at
the agreed request, duration, error and connection limits, and restore its
temporary traffic settings afterward.

After testing, operators should stop any local proxy and remove only test-owned
synthetic data using an approved cleanup procedure. Retain the test service,
secret, database and state unless a separately reviewed cleanup authorizes their
removal; deletion protection does not replace a recovery plan.
