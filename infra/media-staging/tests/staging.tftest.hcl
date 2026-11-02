mock_provider "google" {}

run "private_staging_media" {
  command = plan
  variables { upload_allowed_origins = ["https://staging.ideam.app"] }
  assert {
    condition     = alltrue([for bucket in google_storage_bucket.media : bucket.uniform_bucket_level_access && bucket.public_access_prevention == "enforced" && bucket.versioning[0].enabled && !bucket.force_destroy])
    error_message = "Staging buckets must remain private, versioned, and protected from forced deletion."
  }
  assert {
    condition     = length(google_storage_bucket.media["previews"].cors) == 0 && toset(google_storage_bucket.media["uploads"].cors[0].origin) == toset(["https://staging.ideam.app"]) && toset(google_storage_bucket.media["uploads"].cors[0].method) == toset(["POST", "PUT"])
    error_message = "Only the upload bucket may allow the staging browser origin."
  }
}

run "reject_non_staging_origin" {
  command = plan
  variables { upload_allowed_origins = ["*"] }
  expect_failures = [var.upload_allowed_origins]
}

run "default_keeps_staging_origin" {
  command = plan
  assert {
    condition     = toset(google_storage_bucket.media["uploads"].cors[0].origin) == toset(["https://staging.ideam.app"])
    error_message = "The default staging plan must preserve the configured browser origin."
  }
}

run "staging_media_access_is_scoped" {
  command = plan
  assert {
    condition     = google_service_account.upload_signer[0].account_id == "idea-map-staging-upload" && google_storage_bucket_iam_member.upload_creator[0].bucket == "dallasurbanists-idea-map-dev-media-uploads" && google_storage_bucket_iam_member.upload_creator[0].role == "roles/storage.objectCreator" && google_storage_bucket_iam_member.preview_reader[0].bucket == "dallasurbanists-idea-map-dev-media-previews" && google_storage_bucket_iam_member.preview_reader[0].role == "roles/storage.objectViewer" && google_service_account_iam_member.web_signer[0].role == "roles/iam.serviceAccountTokenCreator"
    error_message = "The staging signer and preview reader must use the intended bucket-scoped roles."
  }
}
