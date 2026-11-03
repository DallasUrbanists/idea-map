variable "enable_public_uptime_check" {
  description = "Opt in to a public HTTPS health check; alerting is configured separately."
  type        = bool
  default     = false
}

variable "public_uptime_hostname" {
  description = "Exact approved public application hostname, without scheme, port, or path."
  type        = string
  default     = ""
  validation {
    condition = var.public_uptime_hostname == "" || (
      length(var.public_uptime_hostname) <= 253 &&
      can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.public_uptime_hostname)) &&
      !can(regex("^[0-9.]+$", var.public_uptime_hostname)) &&
      alltrue([for label in split(".", var.public_uptime_hostname) : length(label) <= 63])
    )
    error_message = "Use a lowercase public DNS hostname without a scheme, port, or path."
  }
}

variable "enable_public_uptime_alert" {
  description = "Opt in to an availability alert using existing reviewed notification channels."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_public_uptime_alert || (var.enable_public_uptime_check && length(var.monitoring_notification_channels) > 0)
    error_message = "An availability alert requires the uptime check and at least one existing notification channel."
  }
}

variable "monitoring_notification_channels" {
  description = "Full resource names of existing notification channels in the same project."
  type        = list(string)
  default     = []
  validation {
    condition = length(distinct(var.monitoring_notification_channels)) == length(var.monitoring_notification_channels) && alltrue([
      for channel in var.monitoring_notification_channels :
      startswith(channel, "projects/${var.project_id}/notificationChannels/") &&
      can(regex("^projects/[a-z0-9-]+/notificationChannels/[0-9]+$", channel))
    ])
    error_message = "Use unique notification channel resource names in the selected project."
  }
}

resource "google_monitoring_uptime_check_config" "public_health" {
  count              = var.enable_public_uptime_check ? 1 : 0
  project            = var.project_id
  display_name       = "idea-map-${var.environment}-public-health"
  timeout            = "10s"
  period             = "300s"
  checker_type       = "STATIC_IP_CHECKERS"
  log_check_failures = true

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  content_matchers {
    content = "\"ok\""
    matcher = "MATCHES_JSON_PATH"
    json_path_matcher {
      json_path    = "$.status"
      json_matcher = "EXACT_MATCH"
    }
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.public_uptime_hostname
    }
  }
  lifecycle {
    precondition {
      condition     = var.public_uptime_hostname != ""
      error_message = "Supply the exact reviewed public hostname before enabling the uptime check."
    }
  }
}

resource "google_monitoring_alert_policy" "public_health" {
  count                 = var.enable_public_uptime_alert && var.enable_public_uptime_check ? 1 : 0
  project               = var.project_id
  display_name          = "idea-map-${var.environment}-public-health"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels

  conditions {
    display_name = "Multiple uptime checkers report failure"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.public_health[0].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "600s"
      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
    }
  }
}
