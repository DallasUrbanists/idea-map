variable "upload_allowed_origins" {
  description = "Exact staging browser origins allowed to use signed uploads."
  type        = list(string)
  default     = ["https://staging.ideam.app"]
  validation {
    condition     = length(distinct(var.upload_allowed_origins)) == length(var.upload_allowed_origins) && alltrue([for origin in var.upload_allowed_origins : origin == "https://staging.ideam.app"])
    error_message = "Only the exact staging origin may be allowed."
  }
}
variable "enable_media_access" {
  description = "Enable the dedicated staging upload signer and preview reader grants."
  type        = bool
  default     = true
}
