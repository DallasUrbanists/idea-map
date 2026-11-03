mock_provider "google" {}

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

run "bootstrap_is_nonoperational_and_private" {
  command = plan
  variables { enable_worker_bootstrap = true }
  assert {
    condition     = google_cloud_run_v2_service.runtime["worker"].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY" && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].command) == 3 && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env) == 0 && length(google_cloud_scheduler_job.repair) == 0 && length(google_secret_manager_secret_iam_member.worker_database) == 0
    error_message = "Bootstrap must be private, nonoperational, and have no delivery or database access."
  }
}

run "reject_production_bootstrap" {
  command = plan
  variables {
    environment             = "prod"
    enable_worker_bootstrap = true
  }
  expect_failures = [google_cloud_run_v2_service.runtime["worker"], google_cloud_run_v2_service.runtime["web"]]
}

run "reject_bootstrap_with_delivery" {
  command = plan
  variables {
    enable_worker_bootstrap = true
    enable_task_delivery    = true
  }
  expect_failures = [google_cloud_run_v2_service.runtime["worker"], google_cloud_run_v2_service.runtime["web"]]
}

run "create_temporary_bootstrap" {
  command = apply
  variables { enable_worker_bootstrap = true }
  plan_options {
    target = [google_cloud_run_v2_service.runtime]
  }
  override_resource {
    target = google_cloud_run_v2_service.runtime["worker"]
    values = { uri = "https://worker.synthetic.invalid" }
  }
}

run "replace_bootstrap_with_configured_worker" {
  command = plan
  variables {
    enable_worker_bootstrap        = false
    enable_worker_runtime          = true
    enable_task_delivery           = true
    worker_origin                  = "https://worker.synthetic.invalid"
    worker_database_secret_id      = "synthetic-worker-db-url"
    worker_database_secret_version = "1"
  }
  override_resource {
    target          = google_cloud_run_v2_service.runtime["worker"]
    override_during = plan
    values          = { uri = "https://worker.synthetic.invalid" }
  }
  assert {
    condition     = try(length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].command), 0) == 0 && one([for e in google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env : e if e.name == "WORKER_PROVIDER_MODE"]).value == "provider"
    error_message = "Enabling the real worker must remove the bootstrap command and configure provider mode."
  }
}

