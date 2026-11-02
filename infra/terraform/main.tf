locals {
  services = {
    web    = { image = var.web_image, max_instances = 2, concurrency = 20 }
    worker = { image = var.worker_image, max_instances = 1, concurrency = 1 }
  }
  buckets = {
    uploads = var.bucket_names.uploads
    public  = var.bucket_names.public
    backups = var.bucket_names.backups
  }
}

resource "google_service_account" "runtime" {
  for_each     = local.services
  account_id   = "idea-map-${each.key}-${var.environment}"
  display_name = "Idea Map ${each.key} ${var.environment} runtime"
}

resource "google_cloud_run_v2_service" "runtime" {
  for_each            = local.services
  name                = "idea-map-${each.key}-${var.environment}"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account                  = google_service_account.runtime[each.key].email
    max_instance_request_concurrency = each.value.concurrency
    scaling {
      min_instance_count = 0
      max_instance_count = each.value.max_instances
    }
    containers {
      image = each.value.image
      dynamic "env" {
        for_each = each.key == "web" && var.enable_resend_secrets && var.resend_webhook_secret_version != "" ? [1] : []
        content {
          name = "NUXT_RESEND_WEBHOOK_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.resend["webhook-secret"].secret_id
              version = var.resend_webhook_secret_version
            }
          }
        }
      }
      dynamic "env" {
        for_each = each.key == "worker" && var.enable_worker_runtime && var.enable_task_delivery ? {
          WORKER_ORIGIN        = var.worker_origin
          TASK_INVOKER_EMAIL   = google_service_account.task_invoker[0].email
          REPAIR_INVOKER_EMAIL = google_service_account.repair_invoker[0].email
          CLOUD_TASKS_QUEUE    = "projects/${var.project_id}/locations/${var.region}/queues/${google_cloud_tasks_queue.jobs.name}"
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = each.key == "worker" && var.enable_worker_runtime ? [1] : []
        content {
          name = "WORKER_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.worker_database_secret_id
              version = var.worker_database_secret_version
            }
          }
        }
      }
    }
  }
  lifecycle {
    precondition {
      condition     = var.resend_webhook_secret_version == "" || var.enable_resend_secrets
      error_message = "Enable the Resend secrets before selecting a webhook secret version."
    }
    precondition {
      condition     = !var.enable_worker_runtime || (var.enable_task_delivery && var.worker_origin != "" && var.worker_database_secret_id != "" && var.worker_database_secret_version != "")
      error_message = "Worker runtime requires task delivery, the exact worker origin, and a pinned existing database secret."
    }
    postcondition {
      condition     = each.key != "worker" || !var.enable_worker_runtime || self.uri == var.worker_origin
      error_message = "The configured worker origin must match the Cloud Run service URI."
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.resend, google_secret_manager_secret_iam_member.worker_database]
}

resource "google_storage_bucket" "media" {
  for_each                    = local.buckets
  name                        = each.value
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  dynamic "cors" {
    for_each = each.key == "uploads" && length(var.upload_allowed_origins) > 0 ? [1] : []
    content {
      origin          = var.upload_allowed_origins
      method          = ["POST", "PUT"]
      response_header = ["Content-Type", "x-goog-content-length-range", "x-goog-if-generation-match"]
      max_age_seconds = 300
    }
  }
  lifecycle { prevent_destroy = true }
}

resource "google_cloud_tasks_queue" "jobs" {
  name     = "idea-map-${var.environment}-queue"
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
}
