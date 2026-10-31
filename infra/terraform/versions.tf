terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "6.50.0"
    }
  }
  # A reviewed, pre-existing state bucket and prefix are supplied at init time.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
