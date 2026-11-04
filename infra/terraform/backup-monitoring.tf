variable "enable_backup_failure_alert" {
  description = "Opt in to an alert for an exporter-reported failure."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_backup_failure_alert || (var.enable_backup_job && length(var.monitoring_notification_channels) > 0)
    error_message = "Backup failure alerts require the job and existing notification channels."
  }
}

variable "enable_backup_freshness_alert" {
  description = "Opt in to an alert for absent completed-export signals after the first observed export."
  type        = bool
  default     = false
  validation {
    condition = !var.enable_backup_freshness_alert || (
      var.enable_backup_job && length(var.monitoring_notification_channels) > 0 && var.backup_freshness_seconds >= 3600 &&
      var.backup_freshness_seconds > local.backup_job_timeout_seconds + lookup({
        "*"   = 3600, "*/2" = 7200, "*/3" = 10800, "*/4" = 14400,
        "*/6" = 21600, "*/8" = 28800, "*/12" = 43200
      }, try(split(" ", var.backup_schedule)[1], ""), 86400)
    )
    error_message = "Backup freshness alerts require the job, existing channels, and a window longer than the schedule interval plus the 35-minute job timeout."
  }
}

variable "backup_freshness_seconds" {
  description = "Reviewed completion-signal absence window in whole minutes, at most 23.5 hours."
  type        = number
  default     = 0
  validation {
    condition = var.backup_freshness_seconds >= 0 && var.backup_freshness_seconds <= 84600 && (
      var.backup_freshness_seconds == floor(var.backup_freshness_seconds) && var.backup_freshness_seconds % 60 == 0
    )
    error_message = "Use a whole-minute absence window no greater than 23.5 hours."
  }
}

resource "google_monitoring_alert_policy" "backup_failure" {
  count                 = var.enable_backup_failure_alert ? 1 : 0
  project               = var.project_id
  display_name          = "Idea Map ${var.environment} backup export failure"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels
  conditions {
    display_name = "Backup exporter reported a failure"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_job\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.backup[0].name}\" AND jsonPayload.event=\"backup_export_failed\""
    }
  }
  alert_strategy {
    notification_rate_limit { period = "1800s" }
    auto_close = "3600s"
  }
}

resource "google_logging_metric" "backup_heartbeat" {
  count       = var.enable_backup_freshness_alert ? 1 : 0
  project     = var.project_id
  name        = "idea-map-backup-heartbeat-${var.environment}"
  description = "Completed backup export events for this environment."
  filter      = "resource.type=\"cloud_run_job\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.backup[0].name}\" AND jsonPayload.event=\"backup_export_completed\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "backup_freshness" {
  count                 = var.enable_backup_freshness_alert ? 1 : 0
  project               = var.project_id
  display_name          = "Idea Map ${var.environment} backup export freshness"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels
  conditions {
    display_name = "No completed backup export"
    condition_absent {
      filter   = "resource.type=\"cloud_run_job\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.backup[0].name}\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.backup_heartbeat[0].name}\""
      duration = "${var.backup_freshness_seconds}s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
      trigger { count = 1 }
    }
  }
}
