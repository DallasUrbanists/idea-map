# This independent root owns only the disposable staging SSR service and its IAM.
resource "google_service_account" "web" {
  account_id   = "idea-map-ssr-staging"
  display_name = "Idea Map isolated SSR staging runtime"
}

resource "google_secret_manager_secret_iam_member" "database_reader" {
  project   = var.project_id
  secret_id = var.database_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web.email}"
}

# Cloud SQL Client applies to this isolated staging project, not production.
resource "google_project_iam_member" "cloud_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.web.email}"
}

# Session revocation checks read Firebase Auth users in the staging project.
resource "google_project_iam_member" "firebase_auth_viewer" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.web.email}"
}

resource "google_project_iam_custom_role" "session_issuer" {
  project     = var.project_id
  role_id     = "ideaMapStagingSessionIssuer"
  title       = "Idea Map staging session issuer"
  description = "Issue Firebase session cookies for the isolated staging web service."
  permissions = ["firebaseauth.users.createSession"]
}

resource "google_project_iam_member" "session_issuer" {
  project = var.project_id
  role    = google_project_iam_custom_role.session_issuer.name
  member  = "serviceAccount:${google_service_account.web.email}"
}

resource "google_cloud_run_v2_service" "web" {
  name                 = "idea-map-ssr-staging"
  location             = "us-central1"
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = true
  deletion_protection  = true

  template {
    service_account                  = google_service_account.web.email
    max_instance_request_concurrency = 20
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = ["${var.project_id}:us-central1:idea-map-ssr-staging"]
      }
    }
    containers {
      image = var.web_image
      resources { limits = { cpu = "1", memory = "512Mi" } }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "NUXT_SESSION_ORIGIN"
        value = var.session_origin
      }
      env {
        name  = "NUXT_FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "NUXT_PUBLIC_FIREBASE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "NUXT_PUBLIC_FIREBASE_API_KEY"
        value = var.firebase_api_key
      }
      env {
        name  = "NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
        value = var.firebase_auth_domain
      }
      env {
        name = "NUXT_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.database_secret_id
            version = var.database_secret_version
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.database_reader, google_project_iam_member.cloud_sql_client, google_project_iam_member.firebase_auth_viewer, google_project_iam_member.session_issuer]
}
