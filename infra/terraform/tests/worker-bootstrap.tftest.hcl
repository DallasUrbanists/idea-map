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

