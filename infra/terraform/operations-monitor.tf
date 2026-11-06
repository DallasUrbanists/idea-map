variable "enable_operations_monitor" {
  description = "Opt in to a read-only operations collection job and a paused scheduler."
  type        = bool
  default     = false
}

variable "enable_operations_alert" {
  description = "Opt in to an alert for collection failures and threshold breaches."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_operations_alert || (var.enable_operations_monitor && length(var.monitoring_notification_channels) > 0)
    error_message = "Operations alerts require the collector and existing notification channels."
  }
}

variable "enable_operations_freshness_alert" {
  description = "Opt in to a missing successful collection signal after it has emitted data."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_operations_freshness_alert || (var.enable_operations_monitor && length(var.monitoring_notification_channels) > 0)
    error_message = "Operations freshness alerts require the collector and existing notification channels."
  }
}

variable "enable_operations_database_growth_alert" {
  description = "Opt in to a database-size growth alert for the existing operations collector."
  type        = bool
  default     = false
  validation {
    condition = !var.enable_operations_database_growth_alert || (
      var.enable_operations_monitor && length(var.monitoring_notification_channels) > 0 && var.operations_database_growth_percent > 0
    )
    error_message = "Database growth alerts require the collector, existing notification channels, and a positive threshold."
  }
}

variable "operations_database_growth_percent" {
  description = "Reviewed percentage growth threshold over the preceding day, or zero when disabled."
  type        = number
  default     = 0
  validation {
    condition     = var.operations_database_growth_percent >= 0 && var.operations_database_growth_percent <= 1000000
    error_message = "Use a growth percentage between zero and one million."
  }
}

variable "operations_monitor_image" {
  description = "Reviewed worker image digest in this project's Artifact Registry."
  type        = string
  default     = ""
  validation {
    condition = var.operations_monitor_image == "" || (
      can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[a-z0-9-]+/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$", var.operations_monitor_image)) &&
      try(split("/", var.operations_monitor_image)[1], "") == var.project_id
    )
    error_message = "Use an immutable worker image digest in the selected project."
  }
}

variable "operations_database_secret_id" {
  description = "Existing operations-only read-only database URL secret ID."
  type        = string
  default     = ""
  validation {
    condition     = var.operations_database_secret_id == "" || can(regex("^[a-zA-Z0-9_-]{1,255}$", var.operations_database_secret_id))
    error_message = "Use a secret ID without a project path."
  }
}

variable "operations_database_secret_version" {
  description = "Pinned numeric version of the operations-only database secret."
  type        = string
  default     = ""
  validation {
    condition     = var.operations_database_secret_version == "" || can(regex("^[1-9][0-9]*$", var.operations_database_secret_version))
    error_message = "Use an empty value or a numeric secret version."
  }
}

variable "operations_monitor_schedule" {
  description = "Reviewed UTC hourly or evenly spaced subhourly collection schedule."
  type        = string
  default     = ""
  validation {
    condition     = var.operations_monitor_schedule == "" || can(regex("^(0|\\*/(5|10|15|20|30)) \\* \\* \\* \\*$", var.operations_monitor_schedule))
    error_message = "Use an hourly or evenly spaced subhourly UTC cron schedule."
  }
}

variable "operations_thresholds" {
  description = "Positive whole-number thresholds for outbox age, overdue age, queue age, and email events."
  type        = map(number)
  default     = {}
  validation {
    condition = length(var.operations_thresholds) == 0 || (
      toset(keys(var.operations_thresholds)) == toset(["outbox_seconds", "overdue_seconds", "queue_seconds", "email_events"]) &&
      alltrue([for value in values(var.operations_thresholds) : value > 0 && value <= 999999999 && value == floor(value)])
    )
    error_message = "Supply all four positive whole-number thresholds, or leave the map empty."
  }
}

variable "operations_database_capacity_bytes" {
  description = "Reviewed positive byte threshold for the monitored database, or empty when disabled."
  type        = string
  default     = ""
  validation {
    condition = var.operations_database_capacity_bytes == "" || (
      can(regex("^[1-9][0-9]{0,18}$", var.operations_database_capacity_bytes)) &&
      try(tonumber(var.operations_database_capacity_bytes) <= 9223372036854775807, false)
    )
    error_message = "Use an empty value or a positive PostgreSQL bigint byte threshold."
  }
}

resource "google_service_account" "operations_monitor" {
  count        = var.enable_operations_monitor ? 1 : 0
  account_id   = "idea-map-ops-${var.environment}"
  display_name = "Idea Map ${var.environment} operations collector"
}

resource "google_project_iam_custom_role" "operations_queue_reader" {
  count       = var.enable_operations_monitor ? 1 : 0
  project     = var.project_id
  role_id     = "ideaMapOperationsQueueReader_${var.environment}"
  title       = "Idea Map ${var.environment} operations queue listing"
  permissions = ["cloudtasks.tasks.list"]
}

resource "google_cloud_tasks_queue_iam_member" "operations_monitor" {
  count    = var.enable_operations_monitor ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.jobs.name
  role     = google_project_iam_custom_role.operations_queue_reader[0].id
  member   = "serviceAccount:${google_service_account.operations_monitor[0].email}"
}

resource "google_secret_manager_secret_iam_member" "operations_database" {
  count     = var.enable_operations_monitor && var.operations_database_secret_id != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.operations_database_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.operations_monitor[0].email}"
}

resource "google_cloud_run_v2_job" "operations_monitor" {
  count               = var.enable_operations_monitor ? 1 : 0
  project             = var.project_id
  name                = "idea-map-ops-${var.environment}"
  location            = var.region
  deletion_protection = true
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.operations_monitor[0].email
      max_retries     = 0
      timeout         = "120s"
      containers {
        image   = var.operations_monitor_image
        command = ["node", "dist/operations-monitor-cli.js"]
        resources { limits = { cpu = "1", memory = "512Mi" } }
        env {
          name  = "OPERATIONS_TASK_QUEUE"
          value = "projects/${var.project_id}/locations/${var.region}/queues/${google_cloud_tasks_queue.jobs.name}"
        }
        env {
          name = "OPERATIONS_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.operations_database_secret_id
              version = var.operations_database_secret_version
            }
          }
        }
        dynamic "env" {
          for_each = {
            OPERATIONS_OUTBOX_AGE_SECONDS      = try(tostring(var.operations_thresholds.outbox_seconds), "")
            OPERATIONS_OVERDUE_AGE_SECONDS     = try(tostring(var.operations_thresholds.overdue_seconds), "")
            OPERATIONS_QUEUE_AGE_SECONDS       = try(tostring(var.operations_thresholds.queue_seconds), "")
            OPERATIONS_EMAIL_EVENTS            = try(tostring(var.operations_thresholds.email_events), "")
            OPERATIONS_DATABASE_CAPACITY_BYTES = var.operations_database_capacity_bytes
          }
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }
  lifecycle {
    precondition {
      condition = var.operations_monitor_image != "" && var.operations_monitor_schedule != "" && var.operations_database_capacity_bytes != "" && length(var.operations_thresholds) == 4 && (
        var.operations_database_secret_id != "" && var.operations_database_secret_version != "" &&
        var.operations_database_secret_id != var.web_database_secret_id &&
        var.operations_database_secret_id != var.worker_database_secret_id &&
        var.operations_database_secret_id != var.backup_database_secret_id
      )
      error_message = "Operations collection requires reviewed image, schedule, thresholds, and a distinct pinned database secret."
    }
  }
  depends_on = [google_cloud_tasks_queue_iam_member.operations_monitor, google_secret_manager_secret_iam_member.operations_database]
}

resource "google_service_account" "operations_scheduler" {
  count        = var.enable_operations_monitor ? 1 : 0
  account_id   = "idea-map-ops-trigger-${var.environment}"
  display_name = "Idea Map ${var.environment} operations scheduler"
}

resource "google_cloud_run_v2_job_iam_member" "operations_scheduler" {
  count    = var.enable_operations_monitor ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.operations_monitor[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.operations_scheduler[0].email}"
}

resource "google_cloud_scheduler_job" "operations_monitor" {
  count     = var.enable_operations_monitor ? 1 : 0
  project   = var.project_id
  region    = var.region
  name      = "idea-map-${var.environment}-operations"
  schedule  = var.operations_monitor_schedule
  time_zone = "Etc/UTC"
  paused    = true
  retry_config { retry_count = 0 }
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.operations_monitor[0].name}:run"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token { service_account_email = google_service_account.operations_scheduler[0].email }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.operations_scheduler]
}

resource "google_monitoring_alert_policy" "operations_monitor" {
  count                 = var.enable_operations_alert ? 1 : 0
  project               = var.project_id
  display_name          = "Idea Map ${var.environment} operations collection"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels
  conditions {
    display_name = "Collection failure or threshold breach"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_job\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.operations_monitor[0].name}\" AND (jsonPayload.event=\"operations_threshold_breached\" OR jsonPayload.event=\"operations_collection_failed\")"
    }
  }
  alert_strategy {
    notification_rate_limit { period = "1800s" }
    auto_close = "3600s"
  }
}

resource "google_logging_metric" "operations_heartbeat" {
  count       = var.enable_operations_freshness_alert ? 1 : 0
  project     = var.project_id
  name        = "idea-map-ops-heartbeat-${var.environment}"
  description = "Completed aggregate operations assessments for this environment."
  filter      = "resource.type=\"cloud_run_job\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.operations_monitor[0].name}\" AND jsonPayload.event=\"operations_assessment_completed\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "operations_database_size" {
  count           = var.enable_operations_database_growth_alert ? 1 : 0
  project         = var.project_id
  name            = "idea-map-ops-database-size-${var.environment}"
  description     = "Observed size of the single database queried by the operations collector."
  filter          = "resource.type=\"cloud_run_job\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.operations_monitor[0].name}\" AND jsonPayload.event=\"operations_database_size_observed\""
  value_extractor = "EXTRACT(jsonPayload.database_size_bytes)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "By"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 40
      growth_factor      = 2
      scale              = 8192
    }
  }
}

resource "google_monitoring_alert_policy" "operations_database_growth" {
  count                 = var.enable_operations_database_growth_alert ? 1 : 0
  project               = var.project_id
  display_name          = "Idea Map ${var.environment} database growth"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels
  conditions {
    display_name = "Observed database size grows beyond the reviewed percentage"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.operations_monitor[0].name}\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.operations_database_size[0].name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.operations_database_growth_percent
      duration        = "0s"
      # ALIGN_MEAN cannot consume a distribution. Combine the hourly
      # distributions, then reduce them to their numeric mean before comparing.
      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = ["resource.label.project_id", "resource.label.job_name"]
      }
      aggregations {
        alignment_period   = "86400s"
        per_series_aligner = "ALIGN_PERCENT_CHANGE"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "operations_freshness" {
  count                 = var.enable_operations_freshness_alert ? 1 : 0
  project               = var.project_id
  display_name          = "Idea Map ${var.environment} operations collection freshness"
  combiner              = "OR"
  notification_channels = var.monitoring_notification_channels
  conditions {
    display_name = "No completed operations assessment"
    condition_absent {
      filter   = "resource.type=\"cloud_run_job\" AND resource.labels.project_id=\"${var.project_id}\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.operations_monitor[0].name}\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.operations_heartbeat[0].name}\""
      duration = "7200s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
      trigger { count = 1 }
    }
  }
}
