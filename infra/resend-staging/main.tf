# Dedicated synthetic delivery verification; existing staging services are untouched.
resource "google_sql_database" "webhook" {
  name            = "idea_map_resend_staging"
  instance        = "idea-map-ssr-staging"
  deletion_policy = "PREVENT"
  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "idea-map-staging-resend-database-url"
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
}

resource "google_service_account" "webhook" {
  account_id   = "idea-map-resend-staging"
  display_name = "Idea Map staging delivery webhook"
}

resource "google_project_iam_member" "cloud_sql_client" {
  project = "dallasurbanists-idea-map-dev"
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.webhook.email}"
}

resource "google_secret_manager_secret_iam_member" "database_reader" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.webhook.email}"
}

resource "google_secret_manager_secret_iam_member" "webhook_reader" {
  count     = var.webhook_secret_version != "" ? 1 : 0
  secret_id = "projects/dallasurbanists-idea-map-dev/secrets/idea-map-staging-resend-webhook-secret"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.webhook.email}"
}

resource "google_cloud_run_v2_service" "webhook" {
  count                = var.enable_service ? 1 : 0
  name                 = "idea-map-resend-staging"
  location             = "us-central1"
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = true
  deletion_protection  = true

  template {
    service_account                  = google_service_account.webhook.email
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance { instances = ["dallasurbanists-idea-map-dev:us-central1:idea-map-ssr-staging"] }
    }
    containers {
      image = var.web_image
      resources { limits = { cpu = "1", memory = "512Mi" } }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "NUXT_STAGING_WEBHOOK_ONLY"
        value = "true"
      }
      env {
        name = "NUXT_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = var.database_secret_version
          }
        }
      }
      dynamic "env" {
        for_each = var.webhook_secret_version == "" ? [] : [1]
        content {
          name = "NUXT_RESEND_WEBHOOK_SECRET"
          value_source {
            secret_key_ref {
              secret  = "idea-map-staging-resend-webhook-secret"
              version = var.webhook_secret_version
            }
          }
        }
      }
    }
  }
  lifecycle {
    precondition {
      condition     = !var.enable_service || var.database_secret_version != ""
      error_message = "Pin the isolated database secret version before enabling the service."
    }
  }
  depends_on = [google_project_iam_member.cloud_sql_client, google_secret_manager_secret_iam_member.database_reader, google_secret_manager_secret_iam_member.webhook_reader]
}

output "webhook_url" {
  description = "Public endpoint that authenticates Resend requests by signature."
  value       = var.enable_service ? "${google_cloud_run_v2_service.webhook[0].uri}/api/webhooks/resend" : null
}
