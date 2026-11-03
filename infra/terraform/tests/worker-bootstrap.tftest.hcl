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
    condition     = google_cloud_run_v2_service.runtime["worker"].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY" && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].command) == 3 && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env) == 0 && length(google_cloud_scheduler_job.repair) == 0 && length(google_project_iam_member.worker_cloud_sql) == 0
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

run "worker_cloud_sql_requires_runtime" {
  command = plan
  variables { worker_cloud_sql_instance = "synthetic-worker-db" }
  expect_failures = [google_cloud_run_v2_service.runtime["worker"], google_cloud_run_v2_service.runtime["web"]]
}

run "worker_cloud_sql_is_instance_scoped" {
  command = plan
  variables {
    enable_task_delivery           = true
    enable_worker_runtime          = true
    worker_origin                  = "https://worker.synthetic.invalid"
    worker_database_secret_id      = "synthetic-worker-db-url"
    worker_database_secret_version = "1"
    worker_cloud_sql_instance      = "synthetic-worker-db"
  }
  override_resource {
    target          = google_cloud_run_v2_service.runtime["worker"]
    override_during = plan
    values          = { uri = "https://worker.synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.runtime["worker"]
    override_during = plan
    values          = { email = "worker@synthetic.invalid" }
  }
  assert {
    condition     = one(google_cloud_run_v2_service.runtime["worker"].template[0].volumes[0].cloud_sql_instance[0].instances) == "synthetic-idea-map-dev:us-central1:synthetic-worker-db" && google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].volume_mounts[0].mount_path == "/cloudsql" && length(google_cloud_run_v2_service.runtime["web"].template[0].volumes) == 0
    error_message = "Only the worker should mount the selected Cloud SQL instance."
  }
  assert {
    condition     = google_project_iam_member.worker_cloud_sql[0].member == "serviceAccount:worker@synthetic.invalid" && google_project_iam_member.worker_cloud_sql[0].role == "roles/cloudsql.client" && google_project_iam_member.worker_cloud_sql[0].condition[0].expression == "resource.name == 'projects/synthetic-idea-map-dev/instances/synthetic-worker-db' && resource.service == 'sqladmin.googleapis.com'"
    error_message = "Cloud SQL access must be limited to the selected worker and instance."
  }
}
