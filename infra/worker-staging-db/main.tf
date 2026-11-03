terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "6.50.0"
    }
  }
  backend "gcs" {}
}

variable "project_id" {
  description = "Confirmed isolated v2 staging project ID."
  type        = string
  validation {
    condition     = var.project_id == "dallasurbanists-idea-map-dev"
    error_message = "This root is restricted to the isolated staging project."
  }
}

provider "google" {
  project = var.project_id
  region  = "us-central1"
}

# This database is separate from SSR staging and may contain synthetic data only.
resource "google_sql_database_instance" "worker" {
  name                = "idea-map-worker-synthetic"
  region              = "us-central1"
  database_version    = "POSTGRES_17"
  deletion_protection = true
  settings {
    edition                     = "ENTERPRISE"
    tier                        = "db-f1-micro"
    availability_type           = "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    disk_autoresize             = false
    deletion_protection_enabled = true
    connector_enforcement       = "REQUIRED"
    backup_configuration {
      enabled                        = false
      point_in_time_recovery_enabled = false
    }
    ip_configuration {
      ipv4_enabled = true
    }
  }
}

resource "google_sql_database" "worker" {
  name            = "idea_map_test_worker"
  instance        = google_sql_database_instance.worker.name
  deletion_policy = "PREVENT"
  lifecycle { prevent_destroy = true }
}
