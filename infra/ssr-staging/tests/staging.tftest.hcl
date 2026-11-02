mock_provider "google" {}

variables {
  project_id              = "synthetic-idea-map-staging"
  web_image               = "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  session_origin          = "https://staging.example.invalid"
  firebase_api_key        = "synthetic-public-key"
  firebase_auth_domain    = "synthetic.example.invalid"
  database_secret_id      = "synthetic-staging-database"
  database_secret_version = "1"
}

run "isolated_web_configuration" {
  command = plan
  assert {
    condition     = google_cloud_run_v2_service.web.name == "idea-map-ssr-staging" && google_cloud_run_v2_service.web.ingress == "INGRESS_TRAFFIC_ALL"
    error_message = "Only the separate staging web service should allow public ingress."
  }
  assert {
    condition     = google_cloud_run_v2_service.web.template[0].scaling[0].max_instance_count == 2 && google_cloud_run_v2_service.web.deletion_protection
    error_message = "The staging service should have bounded scaling and deletion protection."
  }
  assert {
    condition     = google_cloud_run_v2_service.web.invoker_iam_disabled
    error_message = "The staging web service must allow unauthenticated invocation."
  }
  assert {
    condition     = google_secret_manager_secret_iam_member.database_reader.secret_id == "synthetic-staging-database" && google_secret_manager_secret_iam_member.database_reader.role == "roles/secretmanager.secretAccessor"
    error_message = "The runtime receives access only to the named test database secret."
  }
  assert {
    condition     = google_project_iam_member.cloud_sql_client.role == "roles/cloudsql.client" && contains(google_cloud_run_v2_service.web.template[0].volumes[0].cloud_sql_instance[0].instances, "synthetic-idea-map-staging:us-central1:idea-map-ssr-staging")
    error_message = "The runtime connects to the staging Cloud SQL instance through its mounted connector."
  }
  assert {
    condition     = length(google_project_iam_custom_role.session_issuer.permissions) == 1 && contains(google_project_iam_custom_role.session_issuer.permissions, "firebaseauth.users.createSession")
    error_message = "The session issuer role must contain only the session creation permission."
  }
}

run "reject_unpinned_secret" {
  command = plan
  variables { database_secret_version = "latest" }
  expect_failures = [var.database_secret_version]
}

run "reject_unpinned_image" {
  command = plan
  variables { web_image = "example.invalid/web:latest" }
  expect_failures = [var.web_image]
}
