# The test service is independent of the Cloud SQL-backed staging service.
resource "google_service_account" "runtime" {
  account_id   = "idea-map-neon-test"
  display_name = "Idea Map Neon test runtime"
}

resource "google_secret_manager_secret_iam_member" "database_reader" {
  project   = var.project_id
  secret_id = "idea-map-neon-test-url"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_run_v2_service" "web" {
  name                 = "idea-map-neon-test"
  location             = "us-central1"
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  deletion_protection  = true

  scaling {
    min_instance_count    = 0
    manual_instance_count = 0
  }

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = var.web_image
      resources {
        cpu_idle = false
        limits   = { cpu = "1", memory = "512Mi" }
      }
      env {
        name  = "NUXT_STAGING_HTML_CACHE"
        value = "false"
      }
      env {
        name = "NUXT_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = "idea-map-neon-test-url"
            version = var.database_secret_version
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.database_reader]
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = var.invoker_member
}

output "service_uri" {
  description = "Cloud Run URL for authenticated test requests."
  value       = google_cloud_run_v2_service.web.uri
}
