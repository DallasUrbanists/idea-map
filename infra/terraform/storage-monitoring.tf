variable "enable_storage_capacity_alerts" {
  description = "Opt in to capacity alerts for the existing environment buckets."
  type        = bool
  default     = false
  validation {
    condition = !var.enable_storage_capacity_alerts || (
      length(var.monitoring_notification_channels) > 0 &&
      toset(keys(var.storage_capacity_threshold_bytes)) == toset(keys(var.bucket_names)) &&
      alltrue([for name in values(var.bucket_names) : can(regex("^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$", name))])
    )
    error_message = "Storage alerts require existing channels, valid bucket names, and a threshold for each bucket."
  }
}

variable "storage_capacity_threshold_bytes" {
  description = "Reviewed positive byte thresholds keyed by uploads, public, and backups."
  type        = map(number)
  default     = {}
  validation {
    condition     = alltrue([for size in values(var.storage_capacity_threshold_bytes) : size > 0 && floor(size) == size])
    error_message = "Storage thresholds must be positive whole numbers of bytes."
  }
}

resource "google_monitoring_alert_policy" "bucket_capacity" {
  for_each              = var.enable_storage_capacity_alerts ? var.bucket_names : {}
  project               = var.project_id
  display_name          = "idea-map-${var.environment}-${each.key}-storage-capacity"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels
  conditions {
    display_name = "Bucket storage exceeds the reviewed threshold"
    condition_threshold {
      filter          = "metric.type=\"storage.googleapis.com/storage/v2/total_bytes\" AND resource.type=\"gcs_bucket\" AND resource.label.bucket_name=\"${each.value}\""
      comparison      = "COMPARISON_GT"
      threshold_value = lookup(var.storage_capacity_threshold_bytes, each.key, 0)
      duration        = "0s"
      aggregations {
        alignment_period     = "86400s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.bucket_name"]
      }
    }
  }
}
