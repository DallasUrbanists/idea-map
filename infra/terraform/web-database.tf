# The secret value and versions are prepared separately from Terraform state.
resource "google_secret_manager_secret_iam_member" "web_database" {
  count     = var.web_database_secret_id != "" && var.web_database_secret_version != "" ? 1 : 0
  project   = var.project_id
  secret_id = var.web_database_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime["web"].email}"
}
