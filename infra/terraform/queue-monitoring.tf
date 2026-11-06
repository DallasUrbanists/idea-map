variable "enable_queue_delay_alert" {
  description = "Opt in to an alert on observed Cloud Tasks dispatch delay."
  type        = bool
  default     = false
  validation {
    condition = !var.enable_queue_delay_alert || (
      length(var.monitoring_notification_channels) > 0 && var.queue_delay_threshold_ms > 0
    )
    error_message = "The queue alert requires existing notification channels and a positive delay threshold."
  }
}

variable "queue_delay_threshold_ms" {
  description = "Reviewed threshold in milliseconds for the 99th percentile of observed dispatch delays."
  type        = number
  default     = 0
  validation {
    condition     = var.queue_delay_threshold_ms >= 0 && var.queue_delay_threshold_ms == floor(var.queue_delay_threshold_ms)
    error_message = "Use a nonnegative whole number of milliseconds."
  }
}

resource "google_monitoring_alert_policy" "queue_delay" {
  count                 = var.enable_queue_delay_alert ? 1 : 0
  project               = var.project_id
  display_name          = "Idea Map ${var.environment} task dispatch delay"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels

  conditions {
    display_name = "Observed task dispatch delay exceeds threshold"
    condition_threshold {
      filter          = "resource.type=\"cloud_tasks_queue\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.queue_id=\"${google_cloud_tasks_queue.jobs.name}\" AND metric.type=\"cloudtasks.googleapis.com/queue/task_attempt_delays\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.queue_delay_threshold_ms
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_99"
      }
      trigger { count = 1 }
    }
  }
}
