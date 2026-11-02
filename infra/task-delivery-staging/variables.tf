variable "enable_isolated_staging" {
  description = "Opt in only after an isolated worker, state, and delivery plan are reviewed."
  type        = bool
  default     = false
}
variable "project_id" {
  description = "Explicit isolated synthetic-test project; never a production or v1 project."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Provide an explicit project ID."
  }
}
variable "region" {
  description = "Reviewed region shared by the worker, queue, and scheduler."
  type        = string
  validation {
    condition     = can(regex("^[a-z]+-[a-z0-9]+[0-9]$", var.region))
    error_message = "Provide an explicit Google Cloud region."
  }
}
variable "name_prefix" {
  description = "Distinct synthetic resource prefix; it does not prove isolation."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,12}-synthetic$", var.name_prefix))
    error_message = "Use a short lowercase prefix ending in -synthetic."
  }
}
variable "worker_service_name" {
  description = "Name of the pre-existing isolated Cloud Run worker, owned outside this root."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,61}[a-z0-9]$", var.worker_service_name))
    error_message = "Provide an explicit worker service name."
  }
}
variable "worker_origin" {
  description = "Exact reviewed HTTPS worker origin, without path or trailing slash."
  type        = string
  validation {
    condition     = can(regex("^https://[a-zA-Z0-9.-]+$", var.worker_origin))
    error_message = "Provide an exact HTTPS worker origin."
  }
}
variable "worker_runtime_email" {
  description = "Existing worker-only runtime service account in the isolated project."
  type        = string
  validation {
    condition     = endswith(var.worker_runtime_email, "@${var.project_id}.iam.gserviceaccount.com")
    error_message = "Use an explicit service account in the selected project."
  }
}
variable "worker_image" {
  description = "Exact reviewed immutable image digest already deployed to the isolated worker."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.worker_image))
    error_message = "Provide a reviewed immutable worker image digest."
  }
}
