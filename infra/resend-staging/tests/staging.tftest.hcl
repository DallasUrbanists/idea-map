mock_provider "google" {}

variables {
  web_image = "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

run "safe_bootstrap" {
  command = plan
  assert {
    condition     = length(google_cloud_run_v2_service.webhook) == 0 && length(google_secret_manager_secret_iam_member.webhook_reader) == 0
    error_message = "Bootstrap must not expose a service or grant webhook secret access."
  }
  assert {
    condition     = google_sql_database.webhook.name == "idea_map_resend_staging" && google_sql_database.webhook.instance == "idea-map-ssr-staging" && google_sql_database.webhook.deletion_policy == "PREVENT"
    error_message = "The database must be isolated and protected from deletion."
  }
}

run "service_requires_database_secret" {
  command = plan
  variables { enable_service = true }
  expect_failures = [google_cloud_run_v2_service.webhook]
}

run "service_without_signing_secret_fails_closed" {
  command = plan
  variables {
    enable_service          = true
    database_secret_version = "1"
  }
  assert {
    condition     = length(google_secret_manager_secret_iam_member.webhook_reader) == 0 && !anytrue([for env in google_cloud_run_v2_service.webhook[0].template[0].containers[0].env : env.name == "NUXT_RESEND_WEBHOOK_SECRET"])
    error_message = "The service must not receive an unpinned signing secret."
  }
}

run "scoped_webhook_service" {
  command = plan
  variables {
    enable_service          = true
    database_secret_version = "1"
    webhook_secret_version  = "2"
  }
  assert {
    condition     = google_cloud_run_v2_service.webhook[0].name == "idea-map-resend-staging" && google_cloud_run_v2_service.webhook[0].template[0].scaling[0].max_instance_count == 1 && google_cloud_run_v2_service.webhook[0].deletion_protection
    error_message = "The isolated service must have bounded scaling and deletion protection."
  }
  assert {
    condition     = anytrue([for env in google_cloud_run_v2_service.webhook[0].template[0].containers[0].env : env.name == "NUXT_STAGING_WEBHOOK_ONLY" && env.value == "true"]) && anytrue([for env in google_cloud_run_v2_service.webhook[0].template[0].containers[0].env : env.name == "NUXT_RESEND_WEBHOOK_SECRET" && try(env.value_source[0].secret_key_ref[0].version, "") == "2"])
    error_message = "The service must restrict routes and use the pinned webhook secret."
  }
  assert {
    condition     = google_secret_manager_secret_iam_member.webhook_reader[0].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.database_reader.role == "roles/secretmanager.secretAccessor"
    error_message = "The runtime receives only scoped access to the two required secrets."
  }
}

run "reject_unpinned_versions" {
  command = plan
  variables {
    database_secret_version = "latest"
    webhook_secret_version  = "latest"
  }
  expect_failures = [var.database_secret_version, var.webhook_secret_version]
}
