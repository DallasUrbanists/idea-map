locals {
  backup_job_timeout_seconds = 2100
}

variable "enable_backup_job" {
  description = "Opt in to a backup job and a scheduler that starts paused."
  type        = bool
  default     = false
}

variable "backup_job_image" {
  description = "Reviewed backup image digest in this project's Artifact Registry."
  type        = string
  default     = ""
  validation {
    condition = var.backup_job_image == "" || (
      can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[a-z0-9-]+/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$", var.backup_job_image)) &&
      try(split("/", var.backup_job_image)[1], "") == var.project_id
    )
    error_message = "Use an immutable Artifact Registry image digest in the selected project."
  }
}

variable "backup_project_number" {
  description = "Decimal number of the project that owns the existing backup bucket."
  type        = string
  default     = ""
  validation {
    condition     = var.backup_project_number == "" || can(regex("^[1-9][0-9]{5,19}$", var.backup_project_number))
    error_message = "Use an empty value or the reviewed decimal project number."
  }
}

variable "backup_database_secret_id" {
  description = "Existing backup-only direct database URL secret ID in this project."
  type        = string
  default     = ""
  validation {
    condition     = var.backup_database_secret_id == "" || can(regex("^[a-zA-Z0-9_-]{1,255}$", var.backup_database_secret_id))
    error_message = "Use a secret ID without a project path."
  }
}

variable "backup_database_secret_version" {
  description = "Pinned numeric version of the existing backup database URL secret."
  type        = string
  default     = ""
  validation {
    condition     = var.backup_database_secret_version == "" || can(regex("^[1-9][0-9]*$", var.backup_database_secret_version))
    error_message = "Use an empty value or a numeric secret version, not latest."
  }
}

variable "backup_schedule" {
  description = "Reviewed UTC cron schedule; the scheduler starts paused."
  type        = string
  default     = ""
  validation {
    condition     = var.backup_schedule == "" || can(regex("^[0-5]?[0-9] (\\*|\\*/(2|3|4|6|8|12)|[01]?[0-9]|2[0-3]) \\* \\* \\*$", var.backup_schedule))
    error_message = "Use a daily or evenly spaced subdaily UTC cron schedule."
  }
}

resource "google_service_account" "backup_writer" {
  count        = var.enable_backup_job ? 1 : 0
  account_id   = "idea-map-backup-${var.environment}"
  display_name = "Idea Map ${var.environment} backup writer"
}

resource "google_project_iam_custom_role" "backup_writer" {
  count       = var.enable_backup_job ? 1 : 0
  project     = var.project_id
  role_id     = "ideaMapBackupWriter_${var.environment}"
  title       = "Idea Map ${var.environment} create-only backup writer"
  permissions = ["storage.buckets.get", "storage.objects.create"]
}

resource "google_storage_bucket_iam_member" "backup_writer" {
  count  = var.enable_backup_job && (var.manage_media_buckets || var.manage_backup_bucket_separately) ? 1 : 0
  bucket = var.bucket_names.backups
  role   = google_project_iam_custom_role.backup_writer[0].id
  member = "serviceAccount:${google_service_account.backup_writer[0].email}"
  condition {
    title = "backup_export_prefixes"
    expression = join(" || ", concat(
      ["(resource.type == \"storage.googleapis.com/Bucket\" && resource.name == ${jsonencode("projects/_/buckets/${var.bucket_names.backups}")})"],
      [for kind in ["daily", "weekly", "completion"] : "(resource.type == \"storage.googleapis.com/Object\" && resource.name.startsWith(${jsonencode("projects/_/buckets/${var.bucket_names.backups}/objects/idea-map-v2/${var.environment}/${kind}/")}))"]
    ))
  }
}

resource "google_secret_manager_secret_iam_member" "backup_database" {
  count     = var.enable_backup_job && var.backup_database_secret_id != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.backup_database_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backup_writer[0].email}"
}

resource "google_cloud_run_v2_job" "backup" {
  count               = var.enable_backup_job ? 1 : 0
  project             = var.project_id
  name                = "idea-map-backup-${var.environment}"
  location            = var.region
  deletion_protection = true
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.backup_writer[0].email
      max_retries     = 0
      timeout         = "${local.backup_job_timeout_seconds}s"
      containers {
        image = var.backup_job_image
        resources { limits = { cpu = "1", memory = "512Mi" } }
        env {
          name  = "BACKUP_ENVIRONMENT"
          value = var.environment
        }
        env {
          name  = "BACKUP_BUCKET"
          value = var.bucket_names.backups
        }
        env {
          name  = "BACKUP_PROJECT_NUMBER"
          value = var.backup_project_number
        }
        env {
          name = "BACKUP_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.backup_database_secret_id
              version = var.backup_database_secret_version
            }
          }
        }
      }
    }
  }
  lifecycle {
    precondition {
      condition = (var.manage_media_buckets || var.manage_backup_bucket_separately) && var.backup_job_image != "" && var.backup_project_number != "" && var.backup_schedule != "" && (
        var.backup_database_secret_id != "" && var.backup_database_secret_version != "" &&
        var.backup_database_secret_id != var.worker_database_secret_id &&
        var.backup_database_secret_id != var.web_database_secret_id
      )
      error_message = "Backup setup requires foundation-owned buckets, reviewed image, project number, schedule, and a distinct pinned database secret."
    }
  }
  depends_on = [google_storage_bucket_iam_member.backup_writer, google_secret_manager_secret_iam_member.backup_database]
}

resource "google_service_account" "backup_scheduler" {
  count        = var.enable_backup_job ? 1 : 0
  account_id   = "idea-map-backup-trigger-${var.environment}"
  display_name = "Idea Map ${var.environment} backup scheduler"
}

resource "google_cloud_run_v2_job_iam_member" "backup_scheduler" {
  count    = var.enable_backup_job ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.backup[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.backup_scheduler[0].email}"
}

resource "google_cloud_scheduler_job" "backup" {
  count     = var.enable_backup_job ? 1 : 0
  project   = var.project_id
  region    = var.region
  name      = "idea-map-${var.environment}-backup"
  schedule  = var.backup_schedule
  time_zone = "Etc/UTC"
  paused    = true
  retry_config { retry_count = 0 }
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.backup[0].name}:run"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token { service_account_email = google_service_account.backup_scheduler[0].email }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.backup_scheduler]
}
