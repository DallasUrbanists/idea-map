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
    }
  }
}

resource "google_storage_bucket" "media" {
  for_each                    = local.buckets
  name                        = each.value
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
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
