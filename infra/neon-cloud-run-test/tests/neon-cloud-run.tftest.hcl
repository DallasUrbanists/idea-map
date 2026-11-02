mock_provider "google" {}

variables {
  project_id              = "dallasurbanists-idea-map-dev"
  web_image               = "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  database_secret_version = "1"
  invoker_member          = "user:tester@example.invalid"
}

run "isolated_test_service" {
  command = plan
  assert {
    condition     = google_cloud_run_v2_service.web.name == "idea-map-neon-test" && google_cloud_run_v2_service.web.location == "us-central1" && google_cloud_run_v2_service.web.ingress == "INGRESS_TRAFFIC_ALL" && google_cloud_run_v2_service.web.invoker_iam_disabled == false
    error_message = "The separate test service must require Cloud Run authentication."
  }
  assert {
    condition     = google_cloud_run_v2_service.web.template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.web.template[0].scaling[0].max_instance_count == 2 && google_cloud_run_v2_service.web.template[0].max_instance_request_concurrency == 20
    error_message = "The test service must use the reviewed scale and concurrency bounds."
  }
  assert {
    condition     = google_cloud_run_v2_service.web.scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.web.scaling[0].manual_instance_count == 0
    error_message = "Service scaling must match the provider's automatic zero-minimum defaults."
  }
  assert {
    condition     = google_cloud_run_v2_service.web.deletion_protection && google_cloud_run_v2_service_iam_member.invoker.member == "user:tester@example.invalid" && google_cloud_run_v2_service_iam_member.invoker.role == "roles/run.invoker"
    error_message = "The service must protect deletion and grant invocation to the selected principal."
  }
  assert {
    condition     = google_secret_manager_secret_iam_member.database_reader.secret_id == "idea-map-neon-test-url" && google_secret_manager_secret_iam_member.database_reader.role == "roles/secretmanager.secretAccessor"
    error_message = "The runtime may access only the named test database secret through this root."
  }
  assert {
    condition     = anytrue([for env in google_cloud_run_v2_service.web.template[0].containers[0].env : env.name == "NUXT_DATABASE_URL" && try(env.value_source[0].secret_key_ref[0].secret, "") == "idea-map-neon-test-url" && try(env.value_source[0].secret_key_ref[0].version, "") == "1"])
    error_message = "The service must use a pinned version of the test secret."
  }
  assert {
    condition     = anytrue([for env in google_cloud_run_v2_service.web.template[0].containers[0].env : env.name == "NUXT_STAGING_HTML_CACHE" && env.value == "false"])
    error_message = "The separate test service must disable shared staging HTML caching."
  }
  assert {
    condition     = google_cloud_run_v2_service.web.template[0].containers[0].resources[0].cpu_idle == false
    error_message = "The test service must keep CPU allocated for each instance's lifetime."
  }
}

run "reject_other_project" {
  command = plan
  variables { project_id = "unrelated-production-project" }
  expect_failures = [var.project_id]
}

run "reject_unpinned_image" {
  command = plan
  variables { web_image = "example.invalid/web:latest" }
  expect_failures = [var.web_image]
}

run "reject_unpinned_secret" {
  command = plan
  variables { database_secret_version = "latest" }
  expect_failures = [var.database_secret_version]
}

run "reject_public_invoker" {
  command = plan
  variables { invoker_member = "allUsers" }
  expect_failures = [var.invoker_member]
}
