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

run "bootstrap" {
  command = apply
  plan_options {
    target = [google_cloud_run_v2_service.runtime]
  }
  assert {
    condition = alltrue([
      for service in google_cloud_run_v2_service.runtime :
      service.template[0].scaling[0].min_instance_count == 0 &&
      service.template[0].containers[0].resources[0].cpu_idle
    ])
    error_message = "Both services must use request-based CPU and zero minimum instances."
  }
}

run "release_owns_image_after_bootstrap" {
  command = plan
  plan_options {
    target = [google_cloud_run_v2_service.runtime]
  }
  variables {
    web_image = "example.invalid/web@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }
  assert {
    condition     = google_cloud_run_v2_service.runtime["web"].template[0].containers[0].image == "example.invalid/web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    error_message = "An ordinary Terraform plan must not replace the release-managed image."
  }
}
