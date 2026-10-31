mock_provider "google" {}

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
