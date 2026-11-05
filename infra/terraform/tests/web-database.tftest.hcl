mock_provider "google" {
  override_during = plan
}

variables {
  project_id  = "synthetic-idea-map-dev"
  environment = "dev"
  bucket_names = {
    uploads = "synthetic-idea-map-dev-uploads"
    public  = "synthetic-idea-map-dev-public"
    backups = "synthetic-idea-map-dev-backups"
  }
  web_image    = "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  worker_image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "web_database_is_opt_in" {
  command = plan
  assert {
    condition     = length(google_secret_manager_secret_iam_member.web_database) == 0 && length(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env) == 0
    error_message = "A web database reference and grant must not be created by default."
  }
}

run "web_database_is_scoped_and_pinned" {
  command = plan
  variables {
    web_database_secret_id      = "synthetic-web-db"
    web_database_secret_version = "2"
  }
  override_resource {
    target          = google_service_account.runtime["web"]
    override_during = plan
    values          = { email = "web@synthetic.invalid" }
  }
  assert {
    condition     = one(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env).name == "NUXT_DATABASE_URL" && one(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env).value_source[0].secret_key_ref[0].secret == "synthetic-web-db" && one(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env).value_source[0].secret_key_ref[0].version == "2"
    error_message = "Only the web container must receive the pinned database secret reference."
  }
  assert {
    condition     = google_secret_manager_secret_iam_member.web_database[0].secret_id == "synthetic-web-db" && google_secret_manager_secret_iam_member.web_database[0].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.web_database[0].member == "serviceAccount:web@synthetic.invalid" && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env) == 0
    error_message = "The web runtime must receive secret-level access without exposing the secret to the worker."
  }
}

run "web_database_coexists_with_webhook" {
  command = plan
  variables {
    web_database_secret_id        = "synthetic-web-db"
    web_database_secret_version   = "2"
    enable_resend_secrets         = true
    resend_webhook_secret_version = "3"
  }
  assert {
    condition     = length(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env) == 2 && one([for e in google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env : e if e.name == "NUXT_DATABASE_URL"]).value_source[0].secret_key_ref[0].version == "2" && one([for e in google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env : e if e.name == "NUXT_RESEND_WEBHOOK_SECRET"]).value_source[0].secret_key_ref[0].version == "3"
    error_message = "Web database and webhook references must coexist without changing their versions."
  }
}

run "reject_missing_web_database_version" {
  command = plan
  variables { web_database_secret_id = "synthetic-web-db" }
  expect_failures = [google_cloud_run_v2_service.runtime["web"]]
}

run "reject_missing_web_database_id" {
  command = plan
  variables { web_database_secret_version = "2" }
  expect_failures = [google_cloud_run_v2_service.runtime["web"]]
}

run "reject_unpinned_web_database" {
  command = plan
  variables {
    web_database_secret_id      = "synthetic-web-db"
    web_database_secret_version = "latest"
  }
  expect_failures = [var.web_database_secret_version]
}

run "reject_shared_web_and_worker_secret" {
  command = plan
  variables {
    enable_task_delivery           = true
    enable_worker_runtime          = true
    worker_origin                  = "https://worker.synthetic.invalid"
    worker_database_secret_id      = "synthetic-shared-db"
    worker_database_secret_version = "1"
    web_database_secret_id         = "synthetic-shared-db"
    web_database_secret_version    = "2"
  }
  override_resource {
    target          = google_cloud_run_v2_service.runtime["worker"]
    override_during = plan
    values          = { uri = "https://worker.synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.task_invoker[0]
    override_during = plan
    values          = { name = "projects/synthetic-idea-map-dev/serviceAccounts/task-sa@synthetic-idea-map-dev.iam.gserviceaccount.com" }
  }
  expect_failures = [google_cloud_run_v2_service.runtime["web"]]
}
