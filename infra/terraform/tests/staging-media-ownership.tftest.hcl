mock_provider "google" {
  override_during = plan
}

variables {
  project_id   = "synthetic-idea-map-dev"
  environment  = "dev"
  web_image    = "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  worker_image = "example.invalid/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "development_rehearsal_omits_media" {
  command = plan
  variables { manage_media_buckets = false }
  assert {
    condition     = length(google_storage_bucket.media) == 0 && length(google_service_account.upload_signer) == 0 && length(google_storage_bucket_iam_member.upload_creator) == 0 && length(google_storage_bucket_iam_member.preview_reader) == 0
    error_message = "The development rehearsal must not create or take ownership of media buckets or grants."
  }
  assert {
    condition     = length(google_cloud_run_v2_service.runtime) == 2 && google_cloud_tasks_queue.jobs.name == "idea-map-dev-queue"
    error_message = "Omitting media must retain the web, worker, and task queue foundation."
  }
}

run "reject_media_access_without_managed_buckets" {
  command = plan
  variables {
    manage_media_buckets = false
    enable_media_access  = true
  }
  expect_failures = [google_cloud_run_v2_service.runtime["web"], google_cloud_run_v2_service.runtime["worker"]]
}

run "reject_omitting_production_media" {
  command = plan
  variables {
    environment          = "prod"
    manage_media_buckets = false
  }
  expect_failures = [google_cloud_run_v2_service.runtime["web"], google_cloud_run_v2_service.runtime["worker"]]
}

run "managed_media_still_requires_names" {
  command         = plan
  expect_failures = [var.bucket_names]
}
