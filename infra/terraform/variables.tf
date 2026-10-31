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
