# Only secret containers are managed here. Secret values and versions are never
# supplied to Terraform; runtime access must be reviewed with the integration.
resource "google_secret_manager_secret" "resend" {
  for_each  = var.enable_resend_secrets ? toset(["sending-key", "webhook-secret"]) : toset([])
  secret_id = "idea-map-${var.environment}-resend-${each.key}"

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }
}

# The sender and webhook run under separate identities. No secret values or
# versions are managed by Terraform.
resource "google_secret_manager_secret_iam_member" "resend" {
  for_each = var.enable_resend_secrets ? {
    sending-key    = "worker"
    webhook-secret = "web"
  } : {}

  secret_id = google_secret_manager_secret.resend[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value].email}"
}
