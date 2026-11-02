# These bindings remain opt-in until the upload and publication workflows are
# deployed and their effective inherited permissions have been reviewed.
resource "google_service_account" "upload_signer" {
  count        = var.enable_media_access ? 1 : 0
  account_id   = "idea-map-upload-${var.environment}"
  display_name = "Idea Map ${var.environment} pending upload signer"
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
  member             = "serviceAccount:${google_service_account.runtime["web"].email}"
}

resource "google_storage_bucket_iam_member" "preview_reader" {
  count  = var.enable_media_access ? 1 : 0
  bucket = google_storage_bucket.media["public"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.runtime["web"].email}"
}
