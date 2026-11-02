mock_provider "google" {
  override_during = plan
}

variables {
  project_id  = "synthetic-idea-map-dev"
  environment = "dev"
  bucket_names = {
    uploads = "synthetic-idea-map-dev-uploads"
    public  = "synthetic-idea-map-dev-public"
    backups = "synthetic-idea-map-dev-backups"
  }
  web_image    = "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  worker_image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "bounded_private_foundation" {
  command = plan
  assert {
    condition     = google_cloud_run_v2_service.runtime["web"].template[0].scaling[0].max_instance_count == 2 && google_cloud_run_v2_service.runtime["worker"].template[0].scaling[0].max_instance_count == 1
    error_message = "Web and worker instance maxima must remain bounded."
  }
  assert {
    condition     = google_cloud_run_v2_service.runtime["web"].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY" && google_cloud_run_v2_service.runtime["worker"].ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY"
    error_message = "Services must remain private pending reviewed ingress and IAM."
  }
  assert {
    condition     = alltrue([for bucket in google_storage_bucket.media : bucket.public_access_prevention == "enforced" && bucket.force_destroy == false])
    error_message = "All buckets must prevent public access and forced deletion."
  }
}

run "reject_invalid_environment" {
  command = plan
  variables { environment = "v1" }
  expect_failures = [var.environment]
}

run "reject_duplicate_buckets" {
  command = plan
  variables {
    bucket_names = { uploads = "same", public = "same", backups = "backup" }
  }
  expect_failures = [var.bucket_names]
}

run "resend_secrets_are_opt_in" {
  command = plan
  assert {
    condition     = length(google_secret_manager_secret.resend) == 0
    error_message = "Resend secrets must not be created without an explicit opt-in."
  }
  assert {
    condition     = length(google_secret_manager_secret_iam_member.resend) == 0
    error_message = "Resend secret grants must not be created without an explicit opt-in."
  }
}

run "resend_secrets_are_separate" {
  command = plan
  variables { enable_resend_secrets = true }
  override_resource {
    target          = google_service_account.runtime["web"]
    override_during = plan
    values          = { email = "web@synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.runtime["worker"]
    override_during = plan
    values          = { email = "worker@synthetic.invalid" }
  }
  assert {
    condition     = google_secret_manager_secret.resend["sending-key"].secret_id == "idea-map-dev-resend-sending-key" && google_secret_manager_secret.resend["webhook-secret"].secret_id == "idea-map-dev-resend-webhook-secret"
    error_message = "Sending and webhook credentials must have distinct environment-specific containers."
  }
  assert {
    condition     = google_secret_manager_secret_iam_member.resend["sending-key"].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.resend["webhook-secret"].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.resend["sending-key"].member == "serviceAccount:${google_service_account.runtime["worker"].email}" && google_secret_manager_secret_iam_member.resend["webhook-secret"].member == "serviceAccount:${google_service_account.runtime["web"].email}"
    error_message = "Only the worker and web runtimes may receive access to their respective Resend secrets."
  }
}

run "media_access_is_opt_in" {
  command = plan
  assert {
    condition     = length(google_service_account.upload_signer) == 0 && length(google_storage_bucket_iam_member.upload_creator) == 0 && length(google_storage_bucket_iam_member.preview_reader) == 0 && length(google_service_account_iam_member.web_signer) == 0
    error_message = "Media identities and grants require explicit opt-in."
  }
}

run "media_access_is_scoped" {
  command = plan
  variables { enable_media_access = true }
  override_resource {
    target          = google_service_account.runtime["web"]
    override_during = plan
    values          = { email = "web@synthetic.invalid" }
  }
  override_resource {
    target          = google_service_account.upload_signer[0]
    override_during = plan
    values          = { email = "signer@synthetic-project.iam.gserviceaccount.com", name = "projects/synthetic-project/serviceAccounts/signer@synthetic-project.iam.gserviceaccount.com" }
  }
  assert {
    condition     = google_storage_bucket_iam_member.upload_creator[0].role == "roles/storage.objectCreator" && google_storage_bucket_iam_member.upload_creator[0].bucket == var.bucket_names.uploads && google_storage_bucket_iam_member.upload_creator[0].member == "serviceAccount:signer@synthetic-project.iam.gserviceaccount.com" && google_storage_bucket_iam_member.preview_reader[0].role == "roles/storage.objectViewer" && google_storage_bucket_iam_member.preview_reader[0].bucket == var.bucket_names.public && google_storage_bucket_iam_member.preview_reader[0].member == "serviceAccount:web@synthetic.invalid" && google_service_account_iam_member.web_signer[0].role == "roles/iam.serviceAccountTokenCreator" && google_service_account_iam_member.web_signer[0].member == "serviceAccount:web@synthetic.invalid" && google_service_account_iam_member.web_signer[0].service_account_id == "projects/synthetic-project/serviceAccounts/signer@synthetic-project.iam.gserviceaccount.com"
    error_message = "Media grants must use the create-only, preview-read, and signer roles."
  }
}

run "upload_cors_is_limited" {
  command = plan
  variables { upload_allowed_origins = ["https://staging.ideam.app"] }
  assert {
    condition     = toset(google_storage_bucket.media["uploads"].cors[0].origin) == toset(["https://staging.ideam.app"]) && toset(google_storage_bucket.media["uploads"].cors[0].method) == toset(["POST", "PUT"]) && toset(google_storage_bucket.media["uploads"].cors[0].response_header) == toset(["Content-Type", "x-goog-content-length-range", "x-goog-if-generation-match"]) && length(google_storage_bucket.media["public"].cors) == 0 && length(google_storage_bucket.media["backups"].cors) == 0
    error_message = "Upload CORS must allow only configured origins, methods, and headers on the pending bucket."
  }
}

run "reject_wildcard_upload_origin" {
  command = plan
  variables { upload_allowed_origins = ["*"] }
  expect_failures = [var.upload_allowed_origins]
}

run "webhook_secret_is_pinned" {
  command = plan
  variables {
    enable_resend_secrets         = true
    resend_webhook_secret_version = "1"
  }
  assert {
    condition     = one(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env).name == "NUXT_RESEND_WEBHOOK_SECRET" && one(google_cloud_run_v2_service.runtime["web"].template[0].containers[0].env).value_source[0].secret_key_ref[0].version == "1" && length(google_cloud_run_v2_service.runtime["worker"].template[0].containers[0].env) == 0
    error_message = "Only the web service must receive the pinned webhook secret reference."
  }
}

run "reject_latest_webhook_secret" {
  command = plan
  variables {
    enable_resend_secrets         = true
    resend_webhook_secret_version = "latest"
  }
  expect_failures = [var.resend_webhook_secret_version]
}
