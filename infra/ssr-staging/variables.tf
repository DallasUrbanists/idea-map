variable "project_id" {
  description = "Confirmed isolated v2 staging project ID."
  type        = string
  validation {
    condition     = var.project_id == "dallasurbanists-idea-map-dev"
    error_message = "This root is restricted to the isolated staging project."
  }
}

variable "web_image" {
  description = "Reviewed staging web image, pinned by digest."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "Supply an image pinned by sha256 digest."
  }
}

variable "session_origin" {
  description = "Exact HTTPS origin of the isolated Hosting site."
  type        = string
  validation {
    condition     = var.session_origin == "https://staging.ideam.app"
    error_message = "Supply the isolated staging origin https://staging.ideam.app."
  }
}

variable "firebase_api_key" {
  description = "Public Firebase web API key for the staging project."
  type        = string
  validation {
    condition     = length(trimspace(var.firebase_api_key)) > 0
    error_message = "Supply the staging Firebase web API key."
  }
}

variable "firebase_auth_domain" {
  description = "Public Firebase Auth domain for the staging project."
  type        = string
  validation {
    condition     = length(trimspace(var.firebase_auth_domain)) > 0
    error_message = "Supply the staging Firebase Auth domain."
  }
}

variable "database_secret_id" {
  description = "Existing staging-only Secret Manager secret containing the disposable database URL."
  type        = string
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]+$", var.database_secret_id))
    error_message = "Supply a Secret Manager secret ID, not a URL or secret value."
  }
}

variable "database_secret_version" {
  description = "Immutable numeric version of the staging database URL secret."
  type        = string
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.database_secret_version))
    error_message = "Supply a numeric secret version."
  }
}
