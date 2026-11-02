# No schedule runs until an operator explicitly unpauses the reviewed job.
resource "google_service_account" "task_invoker" {
  count        = var.enable_task_delivery ? 1 : 0
  account_id   = "idea-map-task-${var.environment}"
  display_name = "Idea Map ${var.environment} task invoker"
}

resource "google_service_account" "repair_invoker" {
  count        = var.enable_task_delivery ? 1 : 0
  account_id   = "idea-map-repair-${var.environment}"
  display_name = "Idea Map ${var.environment} repair invoker"
}

resource "google_cloud_run_v2_service_iam_member" "task_invoker" {
  count    = var.enable_task_delivery ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.runtime["worker"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.task_invoker[0].email}"
}

resource "google_cloud_run_v2_service_iam_member" "repair_invoker" {
  count    = var.enable_task_delivery ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.runtime["worker"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.repair_invoker[0].email}"
}

resource "google_cloud_tasks_queue_iam_member" "worker_enqueue" {
  count    = var.enable_task_delivery ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.jobs.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.runtime["worker"].email}"
}

resource "google_cloud_tasks_queue_iam_member" "worker_inspect" {
  count    = var.enable_task_delivery ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.jobs.name
  role     = "roles/cloudtasks.viewer"
  member   = "serviceAccount:${google_service_account.runtime["worker"].email}"
}

resource "google_service_account_iam_member" "worker_task_identity" {
  count              = var.enable_task_delivery ? 1 : 0
  service_account_id = google_service_account.task_invoker[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime["worker"].email}"
}

resource "google_cloud_scheduler_job" "repair" {
  count     = var.enable_task_delivery ? 1 : 0
  name      = "idea-map-${var.environment}-outbox-repair"
  region    = var.region
  schedule  = "0 * * * *"
  time_zone = "Etc/UTC"
  paused    = true
  retry_config { retry_count = 3 }
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.runtime["worker"].uri}/tasks/repair"
    oidc_token {
      service_account_email = google_service_account.repair_invoker[0].email
      audience              = google_cloud_run_v2_service.runtime["worker"].uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.repair_invoker]
}
