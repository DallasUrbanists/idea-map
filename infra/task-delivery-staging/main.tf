# This root owns only synthetic task delivery resources and scoped IAM members.
# It does not create or configure the worker, database, web service, or buckets.
data "google_cloud_run_v2_service" "worker" {
  count    = var.enable_isolated_staging ? 1 : 0
  name     = var.worker_service_name
  location = var.region
}

resource "terraform_data" "reviewed_worker" {
  count = var.enable_isolated_staging ? 1 : 0
  input = var.worker_service_name
  lifecycle {
    precondition {
      condition     = data.google_cloud_run_v2_service.worker[0].uri == var.worker_origin
      error_message = "The reviewed origin must match the selected worker service URI."
    }
    precondition {
      condition     = try(data.google_cloud_run_v2_service.worker[0].template[0].service_account == var.worker_runtime_email, false)
      error_message = "The selected worker must use the reviewed runtime identity."
    }
    precondition {
      condition     = try(length(data.google_cloud_run_v2_service.worker[0].template[0].containers) == 1 && data.google_cloud_run_v2_service.worker[0].template[0].containers[0].image == var.worker_image, false)
      error_message = "The selected worker must run only the reviewed immutable image."
    }
    precondition {
      condition     = data.google_cloud_run_v2_service.worker[0].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY" && !data.google_cloud_run_v2_service.worker[0].invoker_iam_disabled
      error_message = "The selected worker must require IAM and use internal-only ingress."
    }
    precondition {
      condition     = !contains(["${var.name_prefix}-task@${var.project_id}.iam.gserviceaccount.com", "${var.name_prefix}-repair@${var.project_id}.iam.gserviceaccount.com"], var.worker_runtime_email)
      error_message = "The worker runtime and invoker identities must be distinct."
    }
  }
}

resource "google_service_account" "task_invoker" {
  count        = var.enable_isolated_staging ? 1 : 0
  account_id   = "${var.name_prefix}-task"
  display_name = "Idea Map synthetic task invoker"
  depends_on   = [terraform_data.reviewed_worker]
  lifecycle { prevent_destroy = true }
}

resource "google_service_account" "repair_invoker" {
  count        = var.enable_isolated_staging ? 1 : 0
  account_id   = "${var.name_prefix}-repair"
  display_name = "Idea Map synthetic repair invoker"
  depends_on   = [terraform_data.reviewed_worker]
  lifecycle { prevent_destroy = true }
}

resource "google_cloud_tasks_queue" "jobs" {
  count    = var.enable_isolated_staging ? 1 : 0
  name     = "${var.name_prefix}-queue"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 1
    max_dispatches_per_second = 1
  }
  retry_config {
    max_attempts = 5
    min_backoff  = "10s"
    max_backoff  = "300s"
  }
  depends_on = [terraform_data.reviewed_worker]
  lifecycle { prevent_destroy = true }
}

resource "google_cloud_run_v2_service_iam_member" "task_invoker" {
  count    = var.enable_isolated_staging ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = var.worker_service_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.task_invoker[0].email}"
}

resource "google_cloud_run_v2_service_iam_member" "repair_invoker" {
  count    = var.enable_isolated_staging ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = var.worker_service_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.repair_invoker[0].email}"
}

resource "google_cloud_tasks_queue_iam_member" "worker_enqueue" {
  count    = var.enable_isolated_staging ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.jobs[0].name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${var.worker_runtime_email}"
}

resource "google_cloud_tasks_queue_iam_member" "worker_inspect" {
  count    = var.enable_isolated_staging ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.jobs[0].name
  role     = "roles/cloudtasks.viewer"
  member   = "serviceAccount:${var.worker_runtime_email}"
}

resource "google_service_account_iam_member" "worker_task_identity" {
  count              = var.enable_isolated_staging ? 1 : 0
  service_account_id = google_service_account.task_invoker[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.worker_runtime_email}"
}

resource "google_cloud_scheduler_job" "repair" {
  count     = var.enable_isolated_staging ? 1 : 0
  name      = "${var.name_prefix}-repair"
  region    = var.region
  schedule  = "0 * * * *"
  time_zone = "Etc/UTC"
  paused    = true
  retry_config { retry_count = 3 }
  http_target {
    http_method = "POST"
    uri         = "${var.worker_origin}/tasks/repair"
    oidc_token {
      service_account_email = google_service_account.repair_invoker[0].email
      audience              = var.worker_origin
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.repair_invoker]
  lifecycle { prevent_destroy = true }
}
