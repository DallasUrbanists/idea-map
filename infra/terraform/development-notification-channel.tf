variable "enable_development_email_channel" {
  description = "Opt in to a separately reviewed development email notification channel."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_development_email_channel || var.environment == "dev"
    error_message = "The optional email notification channel is limited to development."
  }
}

variable "development_notification_email" {
  description = "Reviewed recipient for the optional development channel; do not commit a value."
  type        = string
  default     = ""
  sensitive   = true
  validation {
    condition = !var.enable_development_email_channel || (
      length(var.development_notification_email) <= 254 &&
      length(split("@", var.development_notification_email)[0]) <= 64 &&
      can(regex("^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$", var.development_notification_email))
    )
    error_message = "An enabled development channel requires one supported email address."
  }
}

resource "google_monitoring_notification_channel" "development_email" {
  count        = var.enable_development_email_channel ? 1 : 0
  project      = var.project_id
  display_name = "idea-map-${var.environment}-synthetic-alerts"
  type         = "email"
  labels       = { email_address = var.development_notification_email }
  force_delete = false
}

output "development_email_channel_name" {
  description = "Resource name of the separately reviewed development channel, if enabled."
  value       = try(google_monitoring_notification_channel.development_email[0].name, null)
}
