variable "web_image" {
  description = "Reviewed web image pinned by digest."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "Supply an image pinned by sha256 digest."
  }
}

variable "database_secret_version" {
  description = "Pinned numeric version of the isolated webhook database URL."
  type        = string
  default     = ""
  validation {
    condition     = var.database_secret_version == "" || can(regex("^[1-9][0-9]*$", var.database_secret_version))
    error_message = "Use an empty value or a numeric database secret version."
  }
}

variable "webhook_secret_version" {
  description = "Pinned numeric signing-secret version; empty keeps the endpoint unavailable."
  type        = string
  default     = ""
  validation {
    condition     = var.webhook_secret_version == "" || can(regex("^[1-9][0-9]*$", var.webhook_secret_version))
    error_message = "Use an empty value or a numeric webhook secret version."
  }
}

variable "enable_service" {
  description = "Deploy the isolated webhook test service after its database credential is ready."
  type        = bool
  default     = false
}
