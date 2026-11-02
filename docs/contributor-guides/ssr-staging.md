# Isolated staging for server-side rendering

This guide helps operators maintain and test the staging environment for
*server-side rendering (SSR)* and public HTML caching. The site is
[staging.ideam.app](https://staging.ideam.app/) in Firebase project
`dallasurbanists-idea-map-dev` and Hosting site `dallasurbanists-idea-map-dev`.
Operators should use this environment only for synthetic data and test accounts.

The following sections cover the environment and its operation:

- [Resources and access](#resources-and-access)
- [One-time setup for operators](#one-time-setup-for-operators)
- [Start a deployment](#start-a-deployment)
- [Validate staging](#validate-staging)
- [End a test session](#end-a-test-session)

## Resources and access

The following inventory describes the staging resources. *Identity and Access
Management (IAM)* controls access to Google Cloud resources, and a *solid-state
drive (SSD)* stores the database.

| Resource | Purpose |
| --- | --- |
| Cloud Run `idea-map-ssr-staging`, `us-central1` | Serves the public web app. Its invoker IAM check is disabled, so its default URL is also publicly reachable; the application remains responsible for authorization. |
| Cloud SQL `idea-map-ssr-staging` | Runs PostgreSQL 17 with PostGIS on one zonal `db-f1-micro` instance with 10 GB SSD storage, connector enforcement, deletion protection, and no automatic backups. The `idea_map_staging` database contains disposable fixtures. |
| Runtime service account `idea-map-ssr-staging` | Reads the app database secret, connects to Cloud SQL, reads Firebase Auth users, and issues session cookies. Its database user can read the published-idea query's columns but cannot read contacts. |
| Secret Manager `idea-map-ssr-database-url` | Holds the runtime connection URL; Cloud Run uses version 1. |
| Secret Manager `idea-map-ssr-admin-password` | Holds the database administrator credential for migrations and fixture maintenance. The web runtime has no access to this secret. |
| Secret Manager `idea-map-ssr-test-account` | Holds the synthetic Firebase Auth account credentials. The web runtime has no access to this secret. |
| Artifact Registry `idea-map-staging` | Stores staging web images in `us-central1`. |
| Cloud Storage `dallasurbanists-idea-map-dev-ssr-tfstate` | Stores private, versioned Terraform state under separate `staging/ssr-web` and `staging/ssr-database` prefixes. |
| Cloud Storage `dallasurbanists-idea-map-dev-ssr-build` | Stores source archives, build logs, and extracted assets for the dedicated staging build identity. |
| Cloud Storage `dallasurbanists-idea-map-dev_cloudbuild` | Was created by the first unsuccessful build attempt. Its source archive was removed; later builds use the dedicated staging build bucket. |

The Terraform roots do not create the Hosting release, Firebase Auth settings,
secrets and their versions, build identity, buckets, artifact repository, or
database roles and fixtures. Operators should manage and review those resources
separately; applying the roots does not recreate them. The
[foundation plan](../architecture/terraform.md#state-isolation-and-bootstrap)
explains state access and recovery.

Firebase Auth allows email/password sign-in for the synthetic account but blocks
self-service signup. The signup restriction and authorized staging domain were
configured separately and are not declared in `firebase.staging.json`; operators
should preserve and verify them when changing Firebase Auth. Google sign-in is
not configured. The web service uses at most two instances; the database runs
continuously unless an operator stops it.
Shared-core Cloud SQL is not covered by the Cloud SQL service-level agreement.

The November 1, 2026 deployment used image digest
`sha256:ed93775f9365e74f8ebba29388b3ffa8a4ebb99987fdd43f54b9876390e1e0ed`
from Cloud Build `b54d170d-31fe-42fb-bcbf-add71c87e2e3`. The build included
uncommitted changes on top of commit `35d09741eb229c6275c454af673149f131cc0e87`,
so that commit alone cannot reproduce the deployed image. This first Hosting
release had no earlier application release to restore.

## One-time setup for operators

Operators need Node 24.22.1, pnpm 11.25.0, Terraform 1.13 through 1.x, the Google
Cloud and Firebase *command-line interfaces (CLIs)*, and `tar`. For database
checks, operators also need `psql` and the
[Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy).
Cloud Build supplies Docker; a local Docker engine is not required for the
deployment steps. Operators need staging deployment and secret-access permissions,
including permission to use the `idea-map-staging-build` service account.
The [local development setup](development-guide.md#one-time-setup-for-each-checkout)
explains the repository's Node and pnpm setup.

From the repository root, an authorized operator should complete these steps:

1. Sign in to the Google Cloud CLI, Application Default Credentials, and
    Firebase CLI with an account authorized for the staging project. Use
    `gcloud auth login`, `gcloud auth application-default login`, and
    `firebase login` respectively; follow each tool's sign-in prompts.
2. Initialize the web Terraform root against its staging state prefix:

    ```sh
    terraform -chdir=infra/ssr-staging init -backend-config="bucket=dallasurbanists-idea-map-dev-ssr-tfstate" -backend-config="prefix=staging/ssr-web"
    ```

3. To manage the database root, initialize its separate state prefix:

    ```sh
    terraform -chdir=infra/ssr-staging-db init -backend-config="bucket=dallasurbanists-idea-map-dev-ssr-tfstate" -backend-config="prefix=staging/ssr-database"
    ```

Terraform reports a successful initialization for each root. If initialization
fails, the operator should check the account, bucket access, and project before
continuing. State and plan files can contain sensitive information; operators
should keep them out of Git, build uploads, logs, and review notes.

## Start a deployment

From the repository root, an authorized operator should review the source,
target project, cost, current image digest, matching asset archive, and rollback
destination before deploying. The root `.gcloudignore` and `.dockerignore`
exclude local environment files, Terraform state, and generated dependencies;
the operator should still inspect `gcloud meta list-files-for-upload .` for
unexpected files. Do not deploy if the source or destination is unconfirmed.

The operator should build the image and extract its matching assets as follows:

1. Build the reviewed source with a unique image tag:

    ```sh
    gcloud builds submit . --project dallasurbanists-idea-map-dev --region us-central1 --tag us-central1-docker.pkg.dev/dallasurbanists-idea-map-dev/idea-map-staging/web:IMAGE_TAG --service-account projects/dallasurbanists-idea-map-dev/serviceAccounts/idea-map-staging-build@dallasurbanists-idea-map-dev.iam.gserviceaccount.com --gcs-source-staging-dir gs://dallasurbanists-idea-map-dev-ssr-build/source --gcs-log-dir gs://dallasurbanists-idea-map-dev-ssr-build/logs --suppress-logs
    ```

    Replace `IMAGE_TAG` with a unique valid container image tag, such as
    `review-001`; continue only after the build reports `SUCCESS` and inspect
    its logs in the staging Cloud Build console if it fails.
2. Record the resulting immutable image digest:

    ```sh
    gcloud artifacts docker images describe us-central1-docker.pkg.dev/dallasurbanists-idea-map-dev/idea-map-staging/web:IMAGE_TAG --project dallasurbanists-idea-map-dev --format="value(image_summary.digest)"
    ```

    Replace `IMAGE_TAG` with the tag from the build and record the whole digest,
    which begins with `sha256:`, with the source revision.
3. Extract assets from that exact image into the staging build bucket:

    ```sh
    gcloud builds submit --no-source --config cloudbuild.staging-assets.json --project dallasurbanists-idea-map-dev --region us-central1 --service-account projects/dallasurbanists-idea-map-dev/serviceAccounts/idea-map-staging-build@dallasurbanists-idea-map-dev.iam.gserviceaccount.com --gcs-log-dir gs://dallasurbanists-idea-map-dev-ssr-build/logs --substitutions="_IMAGE=us-central1-docker.pkg.dev/dallasurbanists-idea-map-dev/idea-map-staging/web@IMAGE_DIGEST,_DESTINATION=gs://dallasurbanists-idea-map-dev-ssr-build/assets/ASSET_ARCHIVE" --suppress-logs
    ```

    Replace `IMAGE_DIGEST` with the complete `sha256:` digest from the previous
    step and `ASSET_ARCHIVE` with a unique filename, such as `review-001.tar.gz`;
    continue only after the build reports `SUCCESS`.
4. Download and inspect the archive:

    ```sh
    node -e "require('node:fs').mkdirSync('apps/web/.output',{recursive:true})"
    gcloud storage cp gs://dallasurbanists-idea-map-dev-ssr-build/assets/ASSET_ARCHIVE apps/web/.output/staging-assets.tar.gz
    tar -tvzf apps/web/.output/staging-assets.tar.gz
    ```

    Replace `ASSET_ARCHIVE` with the filename from the extraction build and
    confirm that the entries are ordinary files or directories under `public/`,
    with no `..` path components or links; stop if the archive differs.
5. Ensure `apps/web/.output/staging-public` is absent or empty, then extract the
    inspected archive:

    ```sh
    node -e "require('node:fs').mkdirSync('apps/web/.output/staging-public',{recursive:true})"
    tar -xzf apps/web/.output/staging-assets.tar.gz --strip-components=1 -C apps/web/.output/staging-public
    ```

    If the folder contains files from another build, move it aside before this
    step so Firebase does not upload stale assets.

The operator should then prepare a local `infra/ssr-staging/staging.tfvars` file
from the following template. The file is ignored by Git; it contains the public
Firebase web configuration and secret *identifiers*, not secret values.

```hcl
project_id              = "dallasurbanists-idea-map-dev"
web_image               = "us-central1-docker.pkg.dev/dallasurbanists-idea-map-dev/idea-map-staging/web@IMAGE_DIGEST"
session_origin          = "https://staging.ideam.app"
firebase_api_key        = "STAGING_FIREBASE_API_KEY"
firebase_auth_domain    = "dallasurbanists-idea-map-dev.firebaseapp.com"
database_secret_id      = "idea-map-ssr-database-url"
database_secret_version = "1"
```

Operators should replace `IMAGE_DIGEST` with the recorded digest and
`STAGING_FIREBASE_API_KEY` with the staging web app's public API key from Firebase
project settings. Do not put database passwords, account credentials, or other
secret values in the file.

The operator should review and deploy the matching server and assets:

1. Create and inspect a plan for the staging web root:

    ```sh
    terraform -chdir=infra/ssr-staging plan -var-file=staging.tfvars -out=review.tfplan
    terraform -chdir=infra/ssr-staging show review.tfplan
    ```

    Confirm that every action targets the intended staging resources and that
    the image digest matches the asset archive; stop and investigate unexpected
    changes before applying the plan.
2. Apply the reviewed plan and deploy only the staging Hosting target:

    ```sh
    terraform -chdir=infra/ssr-staging apply review.tfplan
    firebase deploy --only hosting:ssr-staging --project dallasurbanists-idea-map-dev --config firebase.staging.json --non-interactive
    ```

    Both commands report completion on success; the `--only` option avoids
    changing Firebase Auth configuration during a Hosting deployment.
3. Run the [staging checks](#validate-staging) and record the image digest,
    asset archive, source revision, and results.

Cloud Run and Hosting update separately, so clients can briefly see mismatched
assets during a rollout. If validation fails, an authorized operator should
reapply the previously recorded image digest through Terraform and repeat the
archive download, extraction, and Hosting deployment steps with its matching
asset archive. If no prior application release or matching archive is available,
the operator should leave the current state intact and coordinate a recovery
with a maintainer.

## Validate staging

The *content delivery network (CDN)* caches eligible public responses. The
approved synthetic idea is
`11111111-1111-4111-8111-111111111111`; the private fixture is
`22222222-2222-4222-8222-222222222222`. Authorized testers can use the Google
Cloud console steps in the [secret-version access instructions](https://cloud.google.com/secret-manager/docs/access-secret-version)
to view test credentials without printing them in a terminal. In a private browser
window, an authorized tester should complete these checks:

1. Open the approved idea at
    `https://staging.ideam.app/suggestion/11111111-1111-4111-8111-111111111111`
    and inspect **Network** response headers and the page source. Confirm the
    title and crawler metadata are in the initial HTML, the response includes
    `public` and `s-maxage=60`, and a linked `/_nuxt/` asset loads.
2. Open the private fixture at its corresponding `/suggestion/` URL. Confirm
    status code `404 Not Found` and a `Cache-Control` header containing `private`
    and `no-store`.
3. Retrieve the synthetic test account from Secret Manager through an approved
    secure workflow, then sign in on the staging **Account** page. Do not copy
    credentials, tokens, or cookies into logs.
4. In the same signed-in window, open `https://staging.ideam.app/api/session`
    and check its response and **Network** headers. Confirm it reports
    `"registered": true` and its `Cache-Control` header contains both `private`
    and `no-store`.
5. Open the approved idea again in the signed-in window and inspect its
    **Network** response headers. Confirm that its `Cache-Control` header
    contains both `private` and `no-store`.

For the withdrawal check, the tester needs the staging database administrator
password from `idea-map-ssr-admin-password` and an authenticated Cloud SQL Auth
Proxy. The `-W` option prompts for the password without putting it in a command
or shell history. The tester should coordinate with other staging users, use a
separate signed-out private browser window and only the approved synthetic fixture,
and restore it even when a check fails. Authorized testers can follow Google's
console workflow described in this section without copying the secret into a
log or review note.

1. In a separate terminal, start the proxy for the staging instance:

    ```sh
    cloud-sql-proxy --gcloud-auth --address 127.0.0.1 --port 15433 dallasurbanists-idea-map-dev:us-central1:idea-map-ssr-staging
    ```

    The proxy reports that it is listening and ready; if port `15433` is in use,
    stop and choose an unused port in both the proxy and `psql` commands.
2. In the separate signed-out private browser window, load the approved idea with
    a unique query string, such as `?cache_probe=review-001`, and reload it until
    **Network** shows `X-Cache: HIT`. If no cache hit is observed, record that
    limitation instead of claiming the CDN expiry was tested.
3. From a second terminal at the repository root, withdraw only the approved synthetic fixture:

    ```sh
    psql -h 127.0.0.1 -p 15433 -U postgres -d idea_map_staging -W -c "UPDATE ideas SET publication_state = 'private' WHERE id = '11111111-1111-4111-8111-111111111111' AND publication_state = 'approved';"
    ```

    Enter the administrator password when prompted and confirm `UPDATE 1`;
    otherwise, stop and investigate the fixture state.
4. Reload the same URL and record when it returns `404 Not Found`. A cached
    public response can remain visible for its 60-second shared-cache lifetime.
5. Restore the fixture, including after a failed check:

    ```sh
    psql -h 127.0.0.1 -p 15433 -U postgres -d idea_map_staging -W -c "UPDATE ideas SET publication_state = 'approved' WHERE id = '11111111-1111-4111-8111-111111111111' AND publication_state = 'private';"
    ```

    Confirm `UPDATE 1` and open the idea with a fresh query string to verify it
    is available again; if restoration fails, notify a maintainer and retain the
    test details for recovery.

## End a test session

After testing, the operator should choose **Sign out on this device** on the
staging **Account** page, close the private browser windows, and press Ctrl+C in
the proxy terminal. From the repository root, the operator can check whether
port `15433` is available:

```sh
node -e "const s=require('node:net').createServer();s.once('error',()=>{console.error('Port 15433 is unavailable');process.exitCode=1});s.listen(15433,'127.0.0.1',()=>{console.log('Port 15433 is available');s.close()})"
```

If a different port was used, the operator should replace `15433` in the command
with that port.
If the port remains unavailable, the operator should identify its owner before
stopping any process.

The operator should record the results without credentials or cookies and remove
only test-owned temporary files. The staging database and its fixtures persist;
stopping the proxy does not stop the database or its charges. Do not destroy
state, data, or shared resources without a separately reviewed cleanup plan.
Stopping Cloud SQL reduces compute charges but does not eliminate storage charges.
