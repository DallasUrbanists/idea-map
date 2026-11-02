locals {
  buckets = {
    uploads  = "dallasurbanists-idea-map-dev-media-uploads"
    previews = "dallasurbanists-idea-map-dev-media-previews"
  }
  secret_ids = toset([
    "idea-map-staging-resend-api-key",
    "idea-map-staging-resend-webhook-secret",
  ])
}

resource "google_storage_bucket" "media" {
  for_each                    = local.buckets
  name                        = each.value
  location                    = "US-CENTRAL1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  soft_delete_policy { retention_duration_seconds = 604800 }
  dynamic "cors" {
    for_each = each.key == "uploads" && length(var.upload_allowed_origins) > 0 ? [1] : []
    content {
      origin          = var.upload_allowed_origins
      method          = ["POST", "PUT"]
      response_header = ["Content-Type", "x-goog-content-length-range", "x-goog-if-generation-match"]
      max_age_seconds = 300
    }
  }
  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret" "resend" {
  for_each  = local.secret_ids
  secret_id = each.key
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
}

resource "google_service_account" "upload_signer" {
  count        = var.enable_media_access ? 1 : 0
  account_id   = "idea-map-staging-upload"
  display_name = "Idea Map staging pending upload signer"
  lifecycle { prevent_destroy = true }
}

resource "google_storage_bucket_iam_member" "upload_creator" {
  count  = var.enable_media_access ? 1 : 0
  bucket = google_storage_bucket.media["uploads"].name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.upload_signer[0].email}"
}

resource "google_service_account_iam_member" "web_signer" {
  count              = var.enable_media_access ? 1 : 0
  service_account_id = google_service_account.upload_signer[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:idea-map-ssr-staging@dallasurbanists-idea-map-dev.iam.gserviceaccount.com"
}

resource "google_storage_bucket_iam_member" "preview_reader" {
  count  = var.enable_media_access ? 1 : 0
  bucket = google_storage_bucket.media["previews"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:idea-map-ssr-staging@dallasurbanists-idea-map-dev.iam.gserviceaccount.com"
}
