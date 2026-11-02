variable "project_id" {
  description = "Existing isolated development project."
  type        = string
  validation {
    condition     = var.project_id == "dallasurbanists-idea-map-dev"
    error_message = "The Neon test service is restricted to the development project."
  }
}

variable "web_image" {
  description = "Reviewed web image pinned by digest."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "Supply an immutable sha256 image digest."
  }
}

variable "database_secret_version" {
  description = "Numeric version of the existing Neon test database URL secret."
  type        = string
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.database_secret_version))
    error_message = "Supply a numeric secret version, not latest."
  }
}

variable "invoker_member" {
  description = "One approved user or service account allowed to invoke the test service."
  type        = string
  validation {
    condition     = can(regex("^(user|serviceAccount):[^@ ]+@[^@ ]+$", var.invoker_member))
    error_message = "Supply one user: or serviceAccount: principal, not public access."
  }
}
