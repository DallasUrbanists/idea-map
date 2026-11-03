variable "project_id" {
  description = "Existing, isolated v2 project ID; never use a v1 project."
  type        = string
  validation {
    condition     = length(trimspace(var.project_id)) > 0
    error_message = "project_id must be explicitly supplied."
  }
}
variable "environment" {
  description = "Separate development or production environment."
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}
variable "region" {
  description = "Reviewed region shared by regional resources."
  type        = string
  default     = "us-central1"
}
variable "bucket_names" {
  description = "Globally unique names for uploads, approved media and backups."
  type = object({
    uploads = string
    public  = string
    backups = string
  })
  validation {
    condition     = length(toset(values(var.bucket_names))) == 3 && alltrue([for name in values(var.bucket_names) : length(trimspace(name)) > 0])
    error_message = "Supply three distinct, nonempty bucket names."
  }
}
variable "web_image" {
  description = "Reviewed immutable web container image digest."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "web_image must use an immutable sha256 digest."
  }
}
variable "worker_image" {
  description = "Reviewed immutable worker container image digest."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.worker_image))
    error_message = "worker_image must use an immutable sha256 digest."
  }
}
variable "enable_resend_secrets" {
  description = "Opt in to empty Resend secret containers and scoped runtime grants; does not create versions."
  type        = bool
  default     = false
}
variable "enable_media_access" {
  description = "Opt in to a create-only upload signer and web access to approved previews."
  type        = bool
  default     = false
}
variable "enable_task_delivery" {
  description = "Opt in to task invoker identities and a paused hourly repair scheduler."
  type        = bool
  default     = false
}
variable "enable_worker_runtime" {
  description = "Opt in to worker task settings and access to an existing database secret."
  type        = bool
  default     = false
}
variable "enable_worker_bootstrap" {
  description = "Temporarily start a non-operational internal worker to discover its generated URI in dev."
  type        = bool
  default     = false
}
variable "worker_origin" {
  description = "Exact HTTPS origin of the reviewed worker service, without a trailing slash."
  type        = string
  default     = ""
  validation {
    condition     = var.worker_origin == "" || can(regex("^https://[a-zA-Z0-9.-]+$", var.worker_origin))
    error_message = "worker_origin must be an exact HTTPS origin without a path or trailing slash."
  }
}
variable "worker_database_secret_id" {
  description = "ID of the existing worker-only database URL secret in this project."
  type        = string
  default     = ""
  validation {
    condition     = var.worker_database_secret_id == "" || can(regex("^[a-zA-Z0-9_-]{1,255}$", var.worker_database_secret_id))
    error_message = "Use a Secret Manager secret ID without a project path."
  }
}
variable "worker_database_secret_version" {
  description = "Pinned numeric version of the worker database URL secret."
  type        = string
  default     = ""
  validation {
    condition     = var.worker_database_secret_version == "" || can(regex("^[1-9][0-9]*$", var.worker_database_secret_version))
    error_message = "Use an empty value or a numeric secret version, not latest."
  }
}
variable "resend_webhook_secret_version" {
  description = "Pinned numeric webhook secret version for the web service; empty leaves the endpoint unconfigured."
  type        = string
  default     = ""
  validation {
    condition     = var.resend_webhook_secret_version == "" || can(regex("^[1-9][0-9]*$", var.resend_webhook_secret_version))
    error_message = "Use an empty value or a numeric secret version, not latest."
  }
}
variable "upload_allowed_origins" {
  description = "Exact browser origins allowed to submit signed uploads; empty disables CORS."
  type        = list(string)
  default     = []
  validation {
    condition = length(distinct(var.upload_allowed_origins)) == length(var.upload_allowed_origins) && alltrue([
      for origin in var.upload_allowed_origins : can(regex("^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?$", origin)) || origin == "http://127.0.0.1:3000"
    ])
    error_message = "Upload origins must be unique exact HTTPS origins or the local demo origin."
  }
}
